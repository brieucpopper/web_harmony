// Key/scale theory, pure (PRD FR7). Pulled forward from M4: the key-row
// highlight (canvas + piano) needs scale membership already.
import type { KeySignature } from '../types'

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const

/** Pitch class 0–11 (C=0), safe for negative / fractional MIDI. */
export function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12
}

/** In-scale pitch classes for the key (root transposed). */
export function scaleSet(key: KeySignature): ReadonlySet<number> {
  const intervals = key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE
  const set = new Set<number>()
  for (const iv of intervals) set.add((key.root + iv) % 12)
  return set
}

export function isInScale(midi: number, key: KeySignature): boolean {
  return scaleSet(key).has(pitchClass(midi))
}

/**
 * Nearest in-scale MIDI (nearest distance, tie → down). M4 snap reuses this.
 * Scale steps are ≤3 semitones, so distance 6 always finds a candidate.
 */
export function nearestInScale(midi: number, key: KeySignature): number {
  const r = Math.round(midi)
  if (isInScale(r, key)) return r
  for (let d = 1; d <= 6; d++) {
    const down = r - d
    if (isInScale(down, key)) return down
    const up = r + d
    if (isInScale(up, key)) return up
  }
  return r
}
