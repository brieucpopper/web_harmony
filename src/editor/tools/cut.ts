// Cut + trim (M3, PRD FR5.1/FR5.3). Pure — curve arrays split/truncate here,
// the project store applies the result and pushes undo.
import { nanoid } from 'nanoid'
import { HOP_SEC, MIDI_C2, MIDI_C6 } from '../../constants'
import { median } from '../../dsp/pitch'
import type { Chunk, Voice } from '../../types'

/** Locate a chunk + the next same-voice start (blocks trim extension). */
export function locateChunk(
  voices: readonly Voice[],
  id: string,
): { voice: Voice; chunk: Chunk; nextStartSec?: number | undefined } | undefined {
  for (const voice of voices) {
    const chunk = voice.chunks.find((c) => c.id === id)
    if (chunk === undefined) continue
    let nextStartSec: number | undefined
    for (const c of voice.chunks) {
      if (c.id !== id && c.startSec >= chunk.endSec - 1e-9) {
        nextStartSec = nextStartSec === undefined ? c.startSec : Math.min(nextStartSec, c.startSec)
      }
    }
    return { voice, chunk, nextStartSec }
  }
  return undefined
}

/** Cut must land this far from either edge (FR5.1). */
export const CUT_EDGE_MARGIN_SEC = 0.04 as const
/** Chunks shorter than this are tracking dust (FR2.4); trim honors it too. */
export const MIN_CHUNK_SEC = 0.06 as const
/** Right-edge extend limit into silence — no audio stretch in V1 (FR5.3). */
export const TRIM_EXTEND_MAX_SEC = 0.5 as const

function clampMidi(m: number): number {
  return Math.min(MIDI_C6, Math.max(MIDI_C2, Math.round(m)))
}

function baseAndCents(curve: readonly number[], fallbackBase: number): { base: number; cents: number } {
  if (curve.length === 0) return { base: fallbackBase, cents: 0 }
  const med = median(curve)
  const base = clampMidi(med)
  return { base, cents: 100 * (med - base) }
}

/**
 * Map a time sub-range to array indices proportionally. Curve and pristine
 * arrays share timing except after trims, so index by fraction, not by slot.
 */
function sliceByTime(
  arr: readonly number[],
  arrStart: number,
  arrEnd: number,
  t0: number,
  t1: number,
): number[] {
  if (arr.length === 0 || arrEnd <= arrStart) return []
  const span = arrEnd - arrStart
  const i0 = Math.max(0, Math.round(((t0 - arrStart) / span) * arr.length))
  const i1 = Math.min(arr.length, Math.round(((t1 - arrStart) / span) * arr.length))
  return arr.slice(i0, Math.max(i0 + 1, i1))
}

/**
 * Split a chunk at t (FR5.1). Returns null when t is within 40 ms of an
 * edge. Curve arrays split proportionally, baseMidi recomputed per side
 * from its own median. A keeps the id, B gets a fresh one (selected after).
 */
export function splitChunkAt(chunk: Chunk, tSec: number): { a: Chunk; b: Chunk } | null {
  if (tSec - chunk.startSec < CUT_EDGE_MARGIN_SEC) return null
  if (chunk.endSec - tSec < CUT_EDGE_MARGIN_SEC) return null
  const idx = Math.round((tSec - chunk.startSec) / HOP_SEC)
  if (idx < 1 || idx >= chunk.curve.length) return null

  const curveA = chunk.curve.slice(0, idx)
  const curveB = chunk.curve.slice(idx)
  const ma = baseAndCents(curveA, chunk.baseMidi)
  const mb = baseAndCents(curveB, chunk.baseMidi)
  const pristineA = sliceByTime(chunk.pristineCurve, chunk.startSec, chunk.endSec, chunk.startSec, tSec)
  const pristineB = sliceByTime(chunk.pristineCurve, chunk.startSec, chunk.endSec, tSec, chunk.endSec)

  const a: Chunk = {
    ...chunk,
    endSec: tSec,
    baseMidi: ma.base,
    centsOffset: ma.cents,
    curve: curveA,
    pristineCurve: pristineA,
  }
  const b: Chunk = {
    ...chunk,
    id: nanoid(),
    startSec: tSec,
    baseMidi: mb.base,
    centsOffset: mb.cents,
    curve: curveB,
    pristineCurve: pristineB,
  }
  return { a, b }
}

/**
 * Right-edge trim (FR5.3): change endSec, truncating the curve or padding it
 * flat at baseMidi for silence extension (no audio stretch in V1).
 * Clamps: min length 60 ms, max +500 ms past the current end, and no overlap
 * into the next same-voice chunk (touch allowed). Left edge fixed.
 */
export function trimChunkEnd(
  chunk: Chunk,
  newEndSec: number,
  nextStartSec?: number,
): Chunk {
  const minEnd = chunk.startSec + MIN_CHUNK_SEC
  let end = Math.max(minEnd, newEndSec)
  end = Math.min(chunk.endSec + TRIM_EXTEND_MAX_SEC, end)
  if (nextStartSec !== undefined) end = Math.min(nextStartSec, end)
  if (end === chunk.endSec) return chunk

  const wantLen = Math.max(1, Math.round((end - chunk.startSec) / HOP_SEC))
  let curve: number[]
  if (wantLen <= chunk.curve.length) {
    curve = chunk.curve.slice(0, wantLen)
  } else {
    curve = [...chunk.curve]
    while (curve.length < wantLen) curve.push(chunk.baseMidi)
  }
  return { ...chunk, endSec: end, curve }
}
