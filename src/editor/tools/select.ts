// Select tool: hit-testing + marquee (M3, PRD FR4.1–FR4.2).
// Pure — no React/DOM imports. PitchCanvas converts pointer events to
// content coords (sec / midiFloat) and calls these.
import { MIDI_C2, MIDI_C6 } from '../../constants'
import type { Chunk, Voice } from '../../types'

/** Right-edge trim handle width (FR5.3): clicks within this band trim. */
export const EDGE_PX = 6 as const

export interface Viewport {
  pxPerSec: number
  pxPerNote: number
  scrollX: number
  scrollY: number
}

export interface ChunkRect {
  x: number
  w: number
  top: number
  h: number
}

export function chunkRect(
  startSec: number,
  endSec: number,
  baseMidi: number,
  pxPerSec: number,
  pxPerNote: number,
  scrollX: number,
  scrollY: number,
): ChunkRect {
  const x = startSec * pxPerSec - scrollX
  const w = Math.max(3, endSec * pxPerSec - startSec * pxPerSec)
  // Row top = midiToY(base) so the block fills its piano row exactly.
  const top = (MIDI_C6 - baseMidi) * pxPerNote - scrollY
  return { x, w, top, h: Math.max(4, pxPerNote) }
}

export interface HitResult {
  chunk: Chunk
  voiceId: string
  edge: 'body' | 'right'
}

/**
 * Topmost chunk under a content point. Later voices / later chunks draw on
 * top, so iterate in reverse. Right-edge band wins over body.
 */
export function hitTest(
  voices: readonly Voice[],
  sec: number,
  midiFloat: number,
  vp: Viewport,
): HitResult | undefined {
  const y = (MIDI_C6 - midiFloat) * vp.pxPerNote - vp.scrollY
  const x = sec * vp.pxPerSec - vp.scrollX
  for (let vi = voices.length - 1; vi >= 0; vi--) {
    const voice = voices[vi]
    if (voice === undefined) continue
    for (let ci = voice.chunks.length - 1; ci >= 0; ci--) {
      const chunk = voice.chunks[ci]
      if (chunk === undefined) continue
      const r = chunkRect(
        chunk.startSec,
        chunk.endSec,
        chunk.baseMidi,
        vp.pxPerSec,
        vp.pxPerNote,
        vp.scrollX,
        vp.scrollY,
      )
      if (x < r.x || x > r.x + r.w || y < r.top || y > r.top + r.h) continue
      return { chunk, voiceId: voice.id, edge: x >= r.x + r.w - EDGE_PX ? 'right' : 'body' }
    }
  }
  return undefined
}

/**
 * Marquee selection (FR4.2): chunks intersecting the time×pitch rect.
 * Pitch is matched against the chunk's row (±0.5 semitone around baseMidi),
 * time against [startSec, endSec]. Selects across all voices (All view).
 */
export function marqueeSelect(
  voices: readonly Voice[],
  t0: number,
  t1: number,
  midiLo: number,
  midiHi: number,
): string[] {
  const lo = Math.min(t0, t1)
  const hi = Math.max(t0, t1)
  const mLo = Math.max(MIDI_C2, Math.min(midiLo, midiHi))
  const mHi = Math.min(MIDI_C6, Math.max(midiLo, midiHi))
  const ids: string[] = []
  for (const voice of voices) {
    for (const chunk of voice.chunks) {
      if (chunk.endSec < lo || chunk.startSec > hi) continue
      if (chunk.baseMidi + 0.5 < mLo || chunk.baseMidi - 0.5 > mHi) continue
      ids.push(chunk.id)
    }
  }
  return ids
}
