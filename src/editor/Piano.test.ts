// Sample-file mapping for piano click preview (fuhton/piano-mp3 assets).
import { describe, expect, it } from 'vitest'
import { midiToSampleFile } from './Piano'

describe('midiToSampleFile', () => {
  it('maps naturals directly', () => {
    expect(midiToSampleFile(60)).toBe('C4.mp3')
    expect(midiToSampleFile(69)).toBe('A4.mp3')
    expect(midiToSampleFile(36)).toBe('C2.mp3')
    expect(midiToSampleFile(84)).toBe('C6.mp3')
  })

  it('uses flat spelling for sharps (asset set has no C# files)', () => {
    expect(midiToSampleFile(61)).toBe('Db4.mp3') // C#4
    expect(midiToSampleFile(63)).toBe('Eb4.mp3') // D#4
    expect(midiToSampleFile(66)).toBe('Gb4.mp3') // F#4
    expect(midiToSampleFile(68)).toBe('Ab4.mp3') // G#4
    expect(midiToSampleFile(70)).toBe('Bb4.mp3') // A#4
  })

  it('clamps outside C2–C6 to the sample range', () => {
    expect(midiToSampleFile(0)).toBe('C2.mp3')
    expect(midiToSampleFile(127)).toBe('C6.mp3')
  })
})
