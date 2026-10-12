// Move math: deltas, grid snap, clamps, rigid curve (PRD FR4.3–FR4.5).
import { describe, expect, it } from 'vitest'
import { applyMove, clampMoveDeltas, deltasFromPixels, keyboardDelta, snapDeltaToGrid } from './move'
import type { Chunk, Voice } from '../../types'

function chunk(over: Partial<Chunk> & { id: string }): Chunk {
  return {
    voiceId: 'v1',
    startSec: 1,
    endSec: 2,
    baseMidi: 64,
    centsOffset: 0,
    curve: [63.8, 64.2],
    origBaseMidi: 64,
    pristineCurve: [63.8, 64.2],
    fineCents: 0,
    ...over,
  }
}

function voice(id: string, chunks: Chunk[]): Voice {
  return { id, name: id, color: '#fff', mute: false, solo: false, volume: 1, chunks }
}

describe('deltasFromPixels', () => {
  it('converts drag pixels to semitone/second deltas', () => {
    // 32 px up at 16 px/note = +2 st; 30 px right at 60 px/sec = +0.5 s.
    expect(deltasFromPixels(30, -32, 60, 16)).toEqual({ dMidi: 2, dSec: 0.5 })
  })
})

describe('snapDeltaToGrid', () => {
  it('lands the origin chunk on a beat (120 BPM → 0.5 s beats)', () => {
    expect(snapDeltaToGrid(1.1, 0.3, 0.5)).toBeCloseTo(0.4, 9)
  })
})

describe('keyboardDelta', () => {
  it('steps pitch and time per FR4.5', () => {
    expect(keyboardDelta('up', false, false, 120)).toEqual({ dMidi: 1, dSec: 0 })
    expect(keyboardDelta('down', true, false, 120)).toEqual({ dMidi: -12, dSec: 0 })
    expect(keyboardDelta('right', false, false, 120)).toEqual({ dMidi: 0, dSec: 0.01 })
    expect(keyboardDelta('left', true, false, 120)).toEqual({ dMidi: 0, dSec: -0.1 })
  })

  it('turns Left/Right into ±1 beat when snapping', () => {
    expect(keyboardDelta('right', false, true, 120)).toEqual({ dMidi: 0, dSec: 0.5 })
    expect(keyboardDelta('left', true, true, 60)).toEqual({ dMidi: 0, dSec: -1 })
  })
})

describe('clampMoveDeltas', () => {
  it('clamps pitch to C2–C6', () => {
    const voices = [voice('v1', [chunk({ id: 'a', baseMidi: 84 })])]
    expect(clampMoveDeltas(voices, ['a'], 5, 0).dMidi).toBe(0)
    expect(clampMoveDeltas(voices, ['a'], -100, 0).dMidi).toBe(36 - 84)
  })

  it('clamps time at zero', () => {
    const voices = [voice('v1', [chunk({ id: 'a', startSec: 0.2, endSec: 1 })])]
    expect(clampMoveDeltas(voices, ['a'], 0, -1).dSec).toBeCloseTo(-0.2, 9)
  })

  it('slides a rightward group to touch the blocker (offsets preserved)', () => {
    const voices = [
      voice('v1', [
        chunk({ id: 'a', startSec: 1, endSec: 2 }),
        chunk({ id: 'b', startSec: 2.5, endSec: 3 }),
      ]),
    ]
    // a wants +1 s but b blocks at 2.5 → group moves +0.5, touching.
    expect(clampMoveDeltas(voices, ['a'], 0, 1).dSec).toBeCloseTo(0.5, 9)
  })

  it('slides a leftward group to touch', () => {
    const voices = [
      voice('v1', [
        chunk({ id: 'a', startSec: 0.5, endSec: 1 }),
        chunk({ id: 'b', startSec: 2, endSec: 3 }),
      ]),
    ]
    expect(clampMoveDeltas(voices, ['b'], 0, -2).dSec).toBeCloseTo(-1, 9)
  })

  it('allows cross-voice overlap', () => {
    const voices = [
      voice('v1', [chunk({ id: 'a', voiceId: 'v1', startSec: 1, endSec: 2 })]),
      voice('v2', [chunk({ id: 'b', voiceId: 'v2', startSec: 2.5, endSec: 3.5 })]),
    ]
    expect(clampMoveDeltas(voices, ['a'], 0, 2).dSec).toBeCloseTo(2, 9)
  })
})

describe('applyMove', () => {
  it('moves rigidly: block + curve shift together, others untouched', () => {
    const voices = [voice('v1', [chunk({ id: 'a' }), chunk({ id: 'b', startSec: 5, endSec: 6 })])]
    const next = applyMove(voices, ['a'], { dMidi: 2, dSec: 0.5 })
    const a = next[0]?.chunks[0]
    expect(a?.startSec).toBeCloseTo(1.5, 9)
    expect(a?.endSec).toBeCloseTo(2.5, 9)
    expect(a?.baseMidi).toBe(66)
    expect(a?.curve).toEqual([65.8, 66.2])
    expect(next[0]?.chunks[1]?.startSec).toBe(5)
  })
})
