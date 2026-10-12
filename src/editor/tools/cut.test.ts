// Cut + trim: curve split, base recompute, edge guards (PRD FR5.1/FR5.3).
import { describe, expect, it } from 'vitest'
import { splitChunkAt, trimChunkEnd } from './cut'
import type { Chunk } from '../../types'

function chunk(over?: Partial<Chunk>): Chunk {
  return {
    id: 'c1',
    voiceId: 'v1',
    startSec: 1,
    endSec: 2,
    baseMidi: 64,
    centsOffset: 0,
    curve: Array.from({ length: 100 }, (_, i) => (i < 50 ? 64 : 67)),
    origBaseMidi: 64,
    pristineCurve: Array.from({ length: 100 }, (_, i) => (i < 50 ? 64 : 67)),
    fineCents: 0,
    ...over,
  }
}

describe('splitChunkAt', () => {
  it('splits curve arrays and recomputes base per side', () => {
    const res = splitChunkAt(chunk(), 1.5)
    expect(res).not.toBeNull()
    expect(res?.a.endSec).toBe(1.5)
    expect(res?.b.startSec).toBe(1.5)
    expect(res?.a.curve).toHaveLength(50)
    expect(res?.b.curve).toHaveLength(50)
    expect(res?.a.baseMidi).toBe(64)
    expect(res?.b.baseMidi).toBe(67)
    // A keeps the id, B is fresh (selected after split per FR5.1).
    expect(res?.a.id).toBe('c1')
    expect(res?.b.id).not.toBe('c1')
  })

  it('rejects cuts within 40 ms of an edge', () => {
    expect(splitChunkAt(chunk(), 1.02)).toBeNull()
    expect(splitChunkAt(chunk(), 1.98)).toBeNull()
  })

  it('keeps orig bookkeeping for M4 delta math', () => {
    const res = splitChunkAt(chunk({ origBaseMidi: 60 }), 1.5)
    expect(res?.a.origBaseMidi).toBe(60)
    expect(res?.b.origBaseMidi).toBe(60)
  })
})

describe('trimChunkEnd', () => {
  it('shortens and truncates the curve', () => {
    const next = trimChunkEnd(chunk(), 1.5)
    expect(next.endSec).toBe(1.5)
    expect(next.curve).toHaveLength(50)
  })

  it('enforces the 60 ms minimum length', () => {
    const next = trimChunkEnd(chunk(), 1.0)
    expect(next.endSec).toBeCloseTo(1.06, 9)
  })

  it('extends at most 500 ms, padding flat at baseMidi', () => {
    const next = trimChunkEnd(chunk(), 5)
    expect(next.endSec).toBeCloseTo(2.5, 9)
    expect(next.curve).toHaveLength(150)
    expect(next.curve.slice(-1)).toEqual([64])
  })

  it('stops at the next same-voice chunk (touch allowed)', () => {
    const next = trimChunkEnd(chunk(), 5, 2.2)
    expect(next.endSec).toBeCloseTo(2.2, 9)
  })
})
