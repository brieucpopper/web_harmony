// M1: ingest validation + mono mixdown (PRD FR1). Pure — no AudioContext.
import { describe, expect, it } from 'vitest'
import { IngestError, mixToMono, validateFileMeta } from './audioUtil'

function fakeFile(name: string, size: number): File {
  return { name, size } as File
}

describe('validateFileMeta', () => {
  it('accepts mp3 and wav', () => {
    expect(() => { validateFileMeta(fakeFile('take.mp3', 1000)); }).not.toThrow()
    expect(() => { validateFileMeta(fakeFile('take.WAV', 1000)); }).not.toThrow()
  })

  it('rejects other extensions', () => {
    try {
      validateFileMeta(fakeFile('song.ogg', 1000))
      expect.unreachable('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(IngestError)
      expect((err as IngestError).code).toBe('type')
    }
  })

  it('rejects files over 20 MB', () => {
    try {
      validateFileMeta(fakeFile('big.mp3', 21 * 1024 * 1024))
      expect.unreachable('should throw')
    } catch (err) {
      expect((err as IngestError).code).toBe('size')
    }
  })

  it('rejects empty files', () => {
    expect(() => { validateFileMeta(fakeFile('empty.mp3', 0)); }).toThrow(IngestError)
  })
})

describe('mixToMono', () => {
  it('passes mono through', () => {
    const ch = new Float32Array([0.5, -0.25, 0])
    const out = mixToMono([ch], 3)
    expect(Array.from(out)).toEqual([0.5, -0.25, 0])
  })

  it('averages stereo', () => {
    const l = new Float32Array([1, -1, 0.5, 0.5])
    const r = new Float32Array([-1, -1, 0.5, 1])
    const out = mixToMono([l, r], 4)
    expect(Array.from(out)).toEqual([0, -1, 0.5, 0.75])
  })

  it('returns silence for no channels', () => {
    expect(Array.from(mixToMono([], 2))).toEqual([0, 0])
  })
})
