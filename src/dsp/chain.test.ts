// M2 chain integration (PRD US1): synth vibrato → track → segment → white
// voice chunk with the wobble preserved. Uses the pitchy sync engine (same
// hop/gates as the worker); the worker/aubio path is covered by e2e ingest.
import { describe, expect, it } from 'vitest'
import { trackPitchSync } from './pitchTrack'
import { segmentFramesToChunks } from './segment'

describe('M2 vibrato chain', () => {
  it('yields one wobbling chunk near A3', async () => {
    const sr = 44100
    // 220 Hz + 5 Hz vibrato, ±5 Hz deviation (~±39c).
    const depth = 5 / (2 * Math.PI * 5)
    const secs = 2
    const mono = new Float32Array(Math.floor(sr * secs))
    for (let i = 0; i < mono.length; i++) {
      const t = i / sr
      mono[i] = 0.5 * Math.sin(2 * Math.PI * (220 * t + depth * Math.sin(2 * Math.PI * 5 * t)))
    }
    const frames = await trackPitchSync(mono, sr)
    const voiced = frames.filter((f) => f.voiced)
    expect(voiced.length).toBeGreaterThan(frames.length * 0.8)

    const chunks = segmentFramesToChunks(frames, 'white')
    expect(chunks).toHaveLength(1)
    const [c] = chunks
    // A3 = MIDI 57 (median lands −6c: FM is asymmetric in log domain).
    expect(c?.baseMidi).toBe(57)
    // Wobble preserved: curve still swings tens of cents (FR2.5, no auto-tune).
    const curve = c?.curve ?? []
    const swing = Math.max(...curve) - Math.min(...curve)
    expect(swing).toBeGreaterThan(0.2)
    expect(swing).toBeLessThan(1.0)
  })

  it('leaves gaps for breaths, not random notes', async () => {
    const sr = 44100
    const mono = new Float32Array(Math.floor(sr * 2.5))
    for (let i = 0; i < mono.length; i++) {
      const t = i / sr
      if (t < 1) mono[i] = 0.5 * Math.sin(2 * Math.PI * 220 * t)
      else if (t >= 1.5) mono[i] = 0.5 * Math.sin(2 * Math.PI * 330 * t)
    }
    const frames = await trackPitchSync(mono, sr)
    const chunks = segmentFramesToChunks(frames, 'white')
    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.baseMidi).toBe(57) // A3
    expect(chunks[1]?.baseMidi).toBe(64) // E4
  })
})
