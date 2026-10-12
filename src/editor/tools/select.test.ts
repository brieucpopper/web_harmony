// Select tool: hit-test priority + marquee intersection (PRD FR4.1–FR4.2).
import { describe, expect, it } from 'vitest'
import { hitTest, marqueeSelect } from './select'
import type { Chunk, Voice } from '../../types'

function chunk(over: Partial<Chunk> & { id: string }): Chunk {
  return {
    voiceId: 'v1',
    startSec: 1,
    endSec: 2,
    baseMidi: 64,
    centsOffset: 0,
    curve: [64, 64.1, 63.9],
    origBaseMidi: 64,
    pristineCurve: [64, 64.1, 63.9],
    fineCents: 0,
    ...over,
  }
}

function voice(id: string, chunks: Chunk[]): Voice {
  return { id, name: id, color: '#fff', mute: false, solo: false, volume: 1, chunks }
}

const VP = { pxPerSec: 60, pxPerNote: 16, scrollX: 0, scrollY: 0 }

describe('hitTest', () => {
  const voices = [voice('v1', [chunk({ id: 'a', startSec: 1, endSec: 2, baseMidi: 64 })])]

  it('hits the chunk body', () => {
    const hit = hitTest(voices, 1.5, 64, VP)
    expect(hit?.chunk.id).toBe('a')
    expect(hit?.edge).toBe('body')
  })

  it('reports the right-edge trim band', () => {
    // Chunk spans x 60..120; 3 px inside the right edge trims.
    const hit = hitTest(voices, (120 - 3) / 60, 64, VP)
    expect(hit?.edge).toBe('right')
  })

  it('misses empty space', () => {
    expect(hitTest(voices, 5, 64, VP)).toBeUndefined()
    expect(hitTest(voices, 1.5, 72, VP)).toBeUndefined()
  })

  it('prefers the later voice (draw order)', () => {
    const two = [
      voice('v1', [chunk({ id: 'a', voiceId: 'v1' })]),
      voice('v2', [chunk({ id: 'b', voiceId: 'v2' })]),
    ]
    expect(hitTest(two, 1.5, 64, VP)?.chunk.id).toBe('b')
  })
})

describe('marqueeSelect', () => {
  const voices = [
    voice('v1', [
      chunk({ id: 'a', voiceId: 'v1', startSec: 1, endSec: 2, baseMidi: 64 }),
      chunk({ id: 'b', voiceId: 'v1', startSec: 3, endSec: 4, baseMidi: 72 }),
    ]),
  ]

  it('selects intersecting chunks only', () => {
    expect(marqueeSelect(voices, 0.5, 2.5, 60, 68)).toEqual(['a'])
  })

  it('is order-independent (drag any direction)', () => {
    expect(marqueeSelect(voices, 2.5, 0.5, 68, 60)).toEqual(['a'])
  })

  it('spans the full pitch range when dragged tall', () => {
    expect(marqueeSelect(voices, 0, 5, 36, 84).sort()).toEqual(['a', 'b'])
  })
})
