// Move math: drag deltas, grid snap, clamps, overlap guard (M3, FR4.3–FR4.5).
// Pure — PitchCanvas and the project store share these, unit-tested here.
import { MIDI_C2, MIDI_C6 } from '../../constants'
import type { Voice } from '../../types'

export interface MoveDelta {
  dMidi: number
  dSec: number
}

/** Pointer pixels → semitone / second deltas (FR4.3). */
export function deltasFromPixels(
  dxPx: number,
  dyPx: number,
  pxPerSec: number,
  pxPerNote: number,
): MoveDelta {
  return { dMidi: Math.round(-dyPx / pxPerNote), dSec: dxPx / pxPerSec }
}

/**
 * Snap-to-grid for time moves (FR4.3): the dragged (origin) chunk lands on a
 * beat; the whole group shifts by the same delta so intervals are preserved.
 */
export function snapDeltaToGrid(originStartSec: number, dSecRaw: number, beatDur: number): number {
  return Math.round((originStartSec + dSecRaw) / beatDur) * beatDur - originStartSec
}

/** Keyboard step (FR4.5). Snap-to-grid turns Left/Right into ±1 beat. */
export function keyboardDelta(
  key: 'left' | 'right' | 'up' | 'down',
  shift: boolean,
  snapToGrid: boolean,
  bpm: number,
): MoveDelta {
  switch (key) {
    case 'left':
    case 'right': {
      const dir = key === 'right' ? 1 : -1
      if (snapToGrid) return { dMidi: 0, dSec: dir * (60 / bpm) }
      return { dMidi: 0, dSec: dir * (shift ? 0.1 : 0.01) }
    }
    case 'up':
    case 'down': {
      const dir = key === 'up' ? 1 : -1
      return { dMidi: dir * (shift ? 12 : 1), dSec: 0 }
    }
  }
}

function clampMidi(m: number): number {
  return Math.min(MIDI_C6, Math.max(MIDI_C2, Math.round(m)))
}

/**
 * Clamp a group move (FR4.3–FR4.4): pitch into C2–C6, time ≥ 0, and no
 * same-voice overlap (slide to touch). Cross-voice overlap stays allowed.
 * Relative offsets are preserved: one clamped delta applies to the group.
 */
export function clampMoveDeltas(
  voices: readonly Voice[],
  ids: readonly string[],
  dMidi: number,
  dSec: number,
): MoveDelta {
  const wanted = new Set(ids)
  let midi = dMidi
  let sec = dSec

  // Pitch clamp across the whole group.
  for (const voice of voices) {
    for (const chunk of voice.chunks) {
      if (!wanted.has(chunk.id)) continue
      const next = chunk.baseMidi + midi
      if (next < MIDI_C2) midi = MIDI_C2 - chunk.baseMidi
      else if (next > MIDI_C6) midi = MIDI_C6 - chunk.baseMidi
    }
  }

  // Time clamp ≥ 0.
  for (const voice of voices) {
    for (const chunk of voice.chunks) {
      if (!wanted.has(chunk.id)) continue
      if (chunk.startSec + sec < 0) sec = -chunk.startSec
    }
  }

  // Same-voice overlap: slide the group to touch the nearest blocker.
  // Selected chunks move together, so only unselected chunks block.
  for (const voice of voices) {
    const blockers = voice.chunks.filter((c) => !wanted.has(c.id))
    if (blockers.length === 0) continue
    const moving = voice.chunks.filter((c) => wanted.has(c.id))
    if (moving.length === 0) continue
    if (sec > 0) {
      for (const m of moving) {
        for (const b of blockers) {
          if (b.startSec >= m.endSec && m.endSec + sec > b.startSec) {
            sec = Math.max(0, b.startSec - m.endSec)
          }
        }
      }
    } else if (sec < 0) {
      for (const m of moving) {
        for (const b of blockers) {
          if (b.endSec <= m.startSec && m.startSec + sec < b.endSec) {
            sec = Math.min(0, b.endSec - m.startSec)
          }
        }
      }
    }
  }

  return { dMidi: midi, dSec: sec }
}

/**
 * Rigid move (PRD §1.2.3): the orange curve shifts with the block, vibrato
 * intact. No auto-centering — baseMidi and every curve sample move by dMidi.
 */
export function applyMove(voices: readonly Voice[], ids: readonly string[], delta: MoveDelta): Voice[] {
  const wanted = new Set(ids)
  return voices.map((voice) => ({
    ...voice,
    chunks: voice.chunks.map((chunk) => {
      if (!wanted.has(chunk.id)) return chunk
      return {
        ...chunk,
        startSec: chunk.startSec + delta.dSec,
        endSec: chunk.endSec + delta.dSec,
        baseMidi: clampMidi(chunk.baseMidi + delta.dMidi),
        curve: chunk.curve.map((v) => v + delta.dMidi),
      }
    }),
  }))
}
