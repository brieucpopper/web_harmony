// Scale membership + snap target (PRD FR7). Pure.
import { describe, expect, it } from 'vitest'
import { isInScale, nearestInScale, pitchClass, scaleSet } from './theory'

describe('pitchClass', () => {
  it('maps MIDI to 0–11 with C=0', () => {
    expect(pitchClass(60)).toBe(0) // C4
    expect(pitchClass(69)).toBe(9) // A4
    expect(pitchClass(61.4)).toBe(1) // rounds to C#4
  })
})

describe('scaleSet', () => {
  it('builds C major', () => {
    expect(scaleSet({ root: 0, mode: 'major' })).toEqual(new Set([0, 2, 4, 5, 7, 9, 11]))
  })

  it('transposes with the root (D major)', () => {
    expect(scaleSet({ root: 2, mode: 'major' })).toEqual(new Set([2, 4, 6, 7, 9, 11, 1]))
  })

  it('builds A minor', () => {
    expect(scaleSet({ root: 9, mode: 'minor' })).toEqual(new Set([9, 11, 0, 2, 4, 5, 7]))
  })
})

describe('isInScale', () => {
  const cMajor = { root: 0, mode: 'major' } as const
  it('accepts scale tones, rejects others', () => {
    expect(isInScale(60, cMajor)).toBe(true) // C4
    expect(isInScale(64, cMajor)).toBe(true) // E4
    expect(isInScale(61, cMajor)).toBe(false) // C#4
    expect(isInScale(66, cMajor)).toBe(false) // F#4
  })
})

describe('nearestInScale', () => {
  const cMajor = { root: 0, mode: 'major' } as const
  it('keeps scale tones', () => {
    expect(nearestInScale(60, cMajor)).toBe(60)
  })

  it('moves to the closest scale tone', () => {
    expect(nearestInScale(61, cMajor)).toBe(60) // C# → C
    expect(nearestInScale(66, cMajor)).toBe(65) // F# → F
  })

  it('breaks ties downward (D# → D, not E)', () => {
    expect(nearestInScale(63, cMajor)).toBe(62)
  })
})
