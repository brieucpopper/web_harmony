// M0 check: Y/X axis math + tuning conversions (PRD FR3.2, NFR8).
import { describe, expect, it } from 'vitest'
import {
  MAX_PX_PER_NOTE,
  MAX_PX_PER_SEC,
  MIDI_C2,
  MIN_PX_PER_NOTE,
  MIN_PX_PER_SEC,
  MIDI_C6,
  NOTE_COUNT,
  formatTime,
  freqToMidiFloat,
  isBlackKey,
  midiToFreq,
  midiToNoteName,
  midiToY,
  secToX,
  xToSec,
  yToMidi,
} from './constants'

describe('axis math', () => {
  it('covers C2–C6 (MIDI 36–84, PRD "~48 notes")', () => {
    expect(MIDI_C2).toBe(36)
    expect(MIDI_C6).toBe(84)
    // Inclusive endpoints: 84 - 36 + 1 = 49 rows; PRD's "48" = semitone steps.
    expect(NOTE_COUNT).toBe(MIDI_C6 - MIDI_C2 + 1)
  })

  it('zoom ranges allow deep inspection', () => {
    expect(MAX_PX_PER_SEC).toBe(600)
    expect(MAX_PX_PER_NOTE).toBe(96)
    expect(MIN_PX_PER_SEC).toBe(5)
    expect(MIN_PX_PER_NOTE).toBe(4)
  })

  it('midiToY inverts yToMidi', () => {
    for (const midi of [36, 60, 64, 69, 84]) {
      expect(yToMidi(midiToY(midi, 16), 16)).toBeCloseTo(midi, 10)
    }
  })

  it('higher pitch = smaller y', () => {
    expect(midiToY(84, 16)).toBe(0)
    expect(midiToY(36, 16)).toBeGreaterThan(midiToY(60, 16))
  })

  it('secToX inverts xToSec', () => {
    expect(xToSec(secToX(12.34, 60), 60)).toBeCloseTo(12.34, 10)
  })
})

describe('tuning (A=440, 12-TET)', () => {
  it('A4 = 440 Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 10)
    expect(freqToMidiFloat(440)).toBeCloseTo(69, 10)
  })

  it('names octaves correctly', () => {
    expect(midiToNoteName(60)).toBe('C4')
    expect(midiToNoteName(69)).toBe('A4')
    expect(midiToNoteName(36)).toBe('C2')
    expect(midiToNoteName(84)).toBe('C6')
  })

  it('detects black keys', () => {
    expect(isBlackKey(61)).toBe(true) // C#4
    expect(isBlackKey(60)).toBe(false) // C4
    expect(isBlackKey(68)).toBe(true) // G#4
  })
})

describe('formatTime', () => {
  it('formats mm:ss.mmm', () => {
    expect(formatTime(0)).toBe('00:00.000')
    expect(formatTime(65.5)).toBe('01:05.500')
    expect(formatTime(-3)).toBe('00:00.000')
  })
})
