// M2: pitch post-processing gates + filters (PRD FR2.2–FR2.3). Pure.
import { describe, expect, it } from 'vitest'
import { midiToFreq } from '../constants'
import { frameRmsDb, hopSamples, median, postProcessFrames } from './pitch'
import type { RawPitchFrame } from './pitch'
import { trackPitchSync } from './pitchTrack'

function raw(f0Hz: number, conf = 1, rmsDb = -20): RawPitchFrame {
  return { f0Hz, conf, rmsDb }
}

describe('hopSamples', () => {
  it('is 441 at 44.1 kHz and scales with rate', () => {
    expect(hopSamples(44100)).toBe(441)
    expect(hopSamples(48000)).toBe(480)
  })
})

describe('frameRmsDb', () => {
  it('floors silence at −90 dB', () => {
    expect(frameRmsDb(new Float32Array(441))).toBe(-90)
    expect(frameRmsDb([])).toBe(-90)
  })

  it('measures a 0.5-amplitude sine near −9 dB', () => {
    const frame = new Float32Array(441)
    for (let i = 0; i < frame.length; i++) {
      frame[i] = 0.5 * Math.sin((2 * Math.PI * i) / 100)
    }
    expect(frameRmsDb(frame)).toBeCloseTo(-9.03, 0)
  })
})

describe('median', () => {
  it('handles odd, even and empty input', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBeCloseTo(2.5, 9)
    expect(median([])).toBe(0)
  })
})

describe('postProcessFrames', () => {
  it('voices a clean 440 Hz frame as A4', () => {
    const [f] = postProcessFrames([raw(440)])
    expect(f?.voiced).toBe(true)
    expect(f?.midiFloat).toBeCloseTo(69, 1)
  })

  it('gates low confidence, low RMS and out-of-range f0', () => {
    const frames = postProcessFrames([
      raw(440, 0.5), // clarity too low
      raw(440, 1, -50), // too quiet
      raw(30, 1), // below 50 Hz
      raw(2000, 1), // above 1200 Hz
      raw(0, 0, -90), // silence
    ])
    expect(frames.map((f) => f.voiced)).toEqual([false, false, false, false, false])
  })

  it('median-5 removes a lone spike but keeps a sustained step', () => {
    const spike = [69, 69, 80, 69, 69].map((m) => raw(midiToFreq(m)))
    const spikeOut = postProcessFrames(spike)
    expect(spikeOut[2]?.midiFloat).toBeCloseTo(69, 0)

    const step = [...Array<number>(5).fill(69), ...Array<number>(5).fill(71)].map((m) =>
      raw(midiToFreq(m)),
    )
    const stepOut = postProcessFrames(step)
    expect(stepOut[4]?.midiFloat).toBeCloseTo(69, 0)
    expect(stepOut[5]?.midiFloat).toBeCloseTo(71, 0)
  })
})

describe('trackPitchSync', () => {
  it('tracks a 440 Hz sine as voiced A4 frames', async () => {
    const sr = 44100
    const mono = new Float32Array(Math.floor(sr * 0.3))
    for (let i = 0; i < mono.length; i++) {
      mono[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr)
    }
    const frames = await trackPitchSync(mono, sr)
    expect(frames).toHaveLength(Math.ceil(mono.length / 441))
    const voiced = frames.filter((f) => f.voiced)
    expect(voiced.length).toBeGreaterThan(frames.length * 0.8)
    for (const f of voiced) expect(f.midiFloat).toBeCloseTo(69, 0)
  })

  it('marks digital silence unvoiced', async () => {
    const frames = await trackPitchSync(new Float32Array(4410), 44100)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.every((f) => !f.voiced)).toBe(true)
  })
})
