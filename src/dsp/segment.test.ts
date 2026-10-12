// M2: segmentation splits/merges/drops (PRD §6.2 / FR2.4). Pure + synthetic.
import { describe, expect, it } from 'vitest'
import { midiToFreq } from '../constants'
import { segmentFramesToChunks } from './segment'
import type { Frame } from '../types'

/** Null = unvoiced gap frame; numbers are exact MIDI floats. */
function mkFrames(midis: Array<number | null>): Frame[] {
  return midis.map((m) => {
    if (m === null) {
      return { f0Hz: 0, midiFloat: 0, conf: 0, rmsDb: -90, voiced: false }
    }
    return { f0Hz: midiToFreq(m), midiFloat: m, conf: 1, rmsDb: -20, voiced: true }
  })
}

function note(midi: number, frames: number): Array<number> {
  return Array<number>(frames).fill(midi)
}

function gap(frames: number): Array<null> {
  return Array<null>(frames).fill(null)
}

describe('segmentFramesToChunks', () => {
  it('returns no chunks for silence', () => {
    expect(segmentFramesToChunks(mkFrames(gap(50)), 'v1')).toEqual([])
    expect(segmentFramesToChunks([], 'v1')).toEqual([])
  })

  it('splits a clean step at the exact frame (±10 ms)', () => {
    const chunks = segmentFramesToChunks(mkFrames([...note(64, 20), ...note(67, 20)]), 'v1')
    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.baseMidi).toBe(64)
    expect(chunks[1]?.baseMidi).toBe(67)
    expect(chunks[0]?.startSec).toBeCloseTo(0, 9)
    expect(chunks[0]?.endSec).toBeCloseTo(0.2, 9)
    expect(chunks[1]?.startSec).toBeCloseTo(0.2, 9)
    expect(chunks[1]?.endSec).toBeCloseTo(0.4, 9)
  })

  it('keeps vibrato in one chunk (no false split)', () => {
    const wobble = Array.from({ length: 30 }, (_, i) => 64 + 0.4 * Math.sin((i / 30) * Math.PI * 6))
    const chunks = segmentFramesToChunks(mkFrames(wobble), 'v1')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.baseMidi).toBe(64)
    expect(chunks[0]?.curve).toHaveLength(30)
  })

  it('merges a 30 ms same-pitch gap, keeps a 40 ms gap split', () => {
    const merged = segmentFramesToChunks(
      mkFrames([...note(64, 10), ...gap(3), ...note(64, 10)]),
      'v1',
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.curve).toHaveLength(23)

    const split = segmentFramesToChunks(
      mkFrames([...note(64, 10), ...gap(4), ...note(64, 10)]),
      'v1',
    )
    expect(split).toHaveLength(2)
  })

  it('does not merge gaps across different pitches', () => {
    const chunks = segmentFramesToChunks(
      mkFrames([...note(64, 10), ...gap(3), ...note(67, 10)]),
      'v1',
    )
    expect(chunks).toHaveLength(2)
  })

  it('drops tracking dust under 60 ms but keeps real notes', () => {
    expect(segmentFramesToChunks(mkFrames(note(64, 5)), 'v1')).toHaveLength(0)
    const kept = segmentFramesToChunks(mkFrames(note(64, 10)), 'v1')
    expect(kept).toHaveLength(1)
    expect(kept[0]?.endSec).toBeCloseTo(0.1, 9)
  })

  it('fills chunk bookkeeping (orig/pristine/fine/curve length)', () => {
    const [c] = segmentFramesToChunks(mkFrames(note(69, 12)), 'v1')
    expect(c?.voiceId).toBe('v1')
    expect(c?.origBaseMidi).toBe(c?.baseMidi)
    expect(c?.fineCents).toBe(0)
    expect(c?.pristineCurve).toEqual(c?.curve)
    expect(c?.pristineCurve).not.toBe(c?.curve)
    expect(c?.curve).toHaveLength(Math.round(((c?.endSec ?? 0) - (c?.startSec ?? 0)) * 100))
    expect(c?.centsOffset).toBeCloseTo(0, 9)
    expect(typeof c?.id).toBe('string')
  })
})
