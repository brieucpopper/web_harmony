// Chunk segmentation, pure (M2, PRD §6.2 / FR2.4). No React/DOM/Audio imports.
import { nanoid } from 'nanoid'
import { HOP_SEC, MIDI_C2, MIDI_C6 } from '../constants'
import { median } from './pitch'
import type { Chunk, Frame, VoiceId } from '../types'

export interface SegmentOptions {
  /** Min voiced run to consider, seconds. Default 0.08 (breaths/clicks ignored). */
  minNoteSec?: number
  /** Merge gap threshold, seconds. Default 0.04. */
  mergeGapSec?: number
  /** Split on sustained jump, semitones. Default 1.0 (100 cents). */
  splitJumpSemi?: number
}

/** Hard floor: chunks shorter than 60 ms are tracking dust (FR2.4). */
const DROP_SEC = 0.06 as const
/** Split needs the jump sustained 50 ms on both sides (5 frames). */
const SPLIT_WIN = 5 as const

interface Piece {
  start: number
  /** Exclusive frame index. */
  end: number
}

function clampMidi(m: number): number {
  return Math.min(MIDI_C6, Math.max(MIDI_C2, Math.round(m)))
}

/** Median voiced MIDI of a frame range (gap frames excluded). */
function rangeMedian(frames: Frame[], start: number, end: number): number {
  const vals: number[] = []
  for (let i = start; i < end; i++) {
    const f = frames[i]
    if (f !== undefined && f.voiced) vals.push(f.midiFloat)
  }
  return median(vals)
}

/**
 * Pitch-track frames → note chunks (white voice, PRD §6.2):
 * contiguous voiced runs → split on >100c jumps sustained 50 ms → merge
 * sub-40 ms gaps when both sides agree within ±50c → drop <60 ms.
 * Curve keeps the natural (median-smoothed) trajectory; base is its rounded
 * median. `pristineCurve`/`origBaseMidi` snapshot creation state for M5 Reset
 * and M4 delta math.
 */
export function segmentFramesToChunks(
  frames: Frame[],
  voiceId: VoiceId,
  options?: SegmentOptions,
): Chunk[] {
  const minNoteSec = options?.minNoteSec ?? 0.08
  const mergeGapSec = options?.mergeGapSec ?? 0.04
  const splitJumpSemi = options?.splitJumpSemi ?? 1.0
  if (frames.length === 0) return []

  const minRunFrames = Math.max(1, Math.ceil(minNoteSec / HOP_SEC))
  const dropFrames = Math.max(1, Math.ceil(DROP_SEC / HOP_SEC))

  // 1. Contiguous voiced runs (breaths/silence are gaps, not notes).
  const runs: Piece[] = []
  let runStart = -1
  for (let i = 0; i <= frames.length; i++) {
    const voiced = i < frames.length && (frames[i]?.voiced ?? false)
    if (voiced && runStart < 0) runStart = i
    else if (!voiced && runStart >= 0) {
      if (i - runStart >= minRunFrames) runs.push({ start: runStart, end: i })
      runStart = -1
    }
  }

  // 2. Split each run where pitch jumps >splitJumpSemi sustained SPLIT_WIN
  // frames on both sides (median-vs-median, so vibrato ±50c never splits).
  // Two detectors, clustered: exact semitone edges (sample-accurate for clean
  // steps) plus the median-window scan (catches jumps with transients).
  const pieces: Piece[] = []
  for (const run of runs) {
    const semi: number[] = []
    for (let i = run.start; i < run.end; i++) semi.push(Math.round(frames[i]?.midiFloat ?? 0))

    // Exact: semitone flips with ≥5 same-semitone frames on both sides.
    const exact: number[] = []
    for (let i = 1; i < semi.length; i++) {
      if ((semi[i] ?? 0) === (semi[i - 1] ?? 0)) continue
      let back = 0
      for (let j = i - 1; j >= 0 && back < SPLIT_WIN && (semi[j] ?? -1) === (semi[i - 1] ?? -2); j--) back++
      let fwd = 0
      for (let j = i; j < semi.length && fwd < SPLIT_WIN && (semi[j] ?? -1) === (semi[i] ?? -2); j++) fwd++
      if (back >= SPLIT_WIN && fwd >= SPLIT_WIN) {
        const prevMed = median(
          Array.from({ length: SPLIT_WIN }, (_, d) => frames[run.start + i - 1 - d]?.midiFloat ?? 0),
        )
        const nextMed = median(
          Array.from({ length: SPLIT_WIN }, (_, d) => frames[run.start + i + d]?.midiFloat ?? 0),
        )
        if (Math.abs(nextMed - prevMed) > splitJumpSemi) exact.push(run.start + i)
      }
    }

    // Median-window scan: catches sustained jumps blurred by transients.
    const rough: number[] = []
    let k = run.start + SPLIT_WIN
    while (k <= run.end - SPLIT_WIN) {
      const prev: number[] = []
      const next: number[] = []
      for (let j = k - SPLIT_WIN; j < k; j++) prev.push(frames[j]?.midiFloat ?? 0)
      for (let j = k; j < k + SPLIT_WIN; j++) next.push(frames[j]?.midiFloat ?? 0)
      if (Math.abs(median(next) - median(prev)) > splitJumpSemi) {
        rough.push(k)
        k += SPLIT_WIN // one transition, one split — skip the settling frames
      } else {
        k += 1
      }
    }

    // Cluster candidates within a window: prefer the exact edge when present.
    const exactSet = new Set(exact)
    const all = [...exact, ...rough].sort((a, b) => a - b)
    const splits: number[] = []
    let c = 0
    while (c < all.length) {
      const cluster: number[] = [all[c] ?? 0]
      while (
        c + 1 < all.length &&
        (all[c + 1] ?? 0) - (cluster[cluster.length - 1] ?? 0) < SPLIT_WIN
      ) {
        cluster.push(all[c + 1] ?? 0)
        c++
      }
      const exactHit = cluster.find((s) => exactSet.has(s))
      if (exactHit !== undefined) splits.push(exactHit)
      else splits.push(cluster[Math.floor(cluster.length / 2)] ?? cluster[0] ?? run.start)
      c++
    }

    let s = run.start
    for (const cut of splits) {
      pieces.push({ start: s, end: cut })
      s = cut
    }
    pieces.push({ start: s, end: run.end })
  }

  // 3. Merge across sub-threshold gaps when neighbours agree within ±50c.
  // Pieces arrive in time order; gaps between them are the unvoiced frames.
  const merged: Piece[] = []
  for (const p of pieces) {
    const last = merged[merged.length - 1]
    if (last === undefined) {
      merged.push({ ...p })
      continue
    }
    const gapSec = (p.start - last.end) * HOP_SEC
    if (gapSec < mergeGapSec) {
      const leftMed = rangeMedian(frames, last.start, last.end)
      const rightMed = rangeMedian(frames, p.start, p.end)
      if (Math.abs(leftMed - rightMed) <= 0.5) {
        last.end = p.end
        continue
      }
    }
    merged.push({ ...p })
  }

  // 4. Build chunks, dropping tracking dust <60 ms.
  const chunks: Chunk[] = []
  for (const m of merged) {
    if (m.end - m.start < dropFrames) continue
    const curve: number[] = new Array<number>(m.end - m.start)
    // Fill gap frames by linear interpolation so curve length always equals
    // round(duration*100) and later rigid moves stay continuous.
    for (let i = m.start; i < m.end; i++) {
      const f = frames[i]
      if (f !== undefined && f.voiced) {
        curve[i - m.start] = f.midiFloat
        continue
      }
      // Nearest voiced neighbours inside the (merged) piece both exist:
      // pieces start/end on voiced frames by construction.
      let lo = i - 1
      while (lo >= m.start && !(frames[lo]?.voiced ?? false)) lo--
      let hi = i + 1
      while (hi < m.end && !(frames[hi]?.voiced ?? false)) hi++
      const loV = frames[lo]?.midiFloat ?? frames[m.start]?.midiFloat ?? 0
      const hiV = frames[hi]?.midiFloat ?? frames[m.end - 1]?.midiFloat ?? loV
      const span = Math.max(1, hi - lo)
      const t = (i - lo) / span
      curve[i - m.start] = loV + (hiV - loV) * t
    }
    const med = median(curve)
    const baseMidi = clampMidi(med)
    chunks.push({
      id: nanoid(),
      voiceId,
      startSec: m.start * HOP_SEC,
      endSec: m.end * HOP_SEC,
      baseMidi,
      centsOffset: 100 * (med - baseMidi),
      curve,
      origBaseMidi: baseMidi,
      pristineCurve: [...curve],
      fineCents: 0,
    })
  }
  return chunks
}
