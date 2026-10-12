// Audio ingest utilities (PRD FR1). Pure DOM/WebAudio, no React.
import { ACCEPTED_EXTENSIONS, MAX_DURATION_SEC, MAX_FILE_MB } from '../constants'

export interface DecodedAudio {
  /** Mono mixdown @ context sample rate (usually 44100/48000). */
  mono: Float32Array
  sampleRate: number
  durationSec: number
  fileName: string
}

export class IngestError extends Error {
  readonly code: 'type' | 'size' | 'duration' | 'decode'
  constructor(code: 'type' | 'size' | 'duration' | 'decode', message: string) {
    super(message)
    this.code = code
  }
}

export function validateFileMeta(file: File): void {
  const lower = file.name.toLowerCase()
  const extOk = ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
  if (!extOk) {
    throw new IngestError('type', `Unsupported file “${file.name}”. Use .mp3 or .wav.`)
  }
  const maxBytes = MAX_FILE_MB * 1024 * 1024
  if (file.size > maxBytes) {
    throw new IngestError(
      'size',
      `File is ${(file.size / 1048576).toFixed(1)} MB — limit is ${MAX_FILE_MB} MB.`,
    )
  }
  if (file.size === 0) {
    throw new IngestError('type', 'File is empty.')
  }
}

/** Average all channels to mono. Pure — unit-testable without AudioContext. */
export function mixToMono(channelData: Float32Array[], length: number): Float32Array {
  const out = new Float32Array(length)
  if (channelData.length === 0) return out
  const first = channelData[0]
  if (channelData.length === 1 && first !== undefined) {
    out.set(first.subarray(0, length))
    return out
  }
  // Note: noUncheckedIndexedAccess makes every indexed read `T | undefined`.
  const weight = 1 / channelData.length
  for (const ch of channelData) {
    const n = Math.min(length, ch.length)
    for (let i = 0; i < n; i++) {
      const sample = ch[i]
      const prev = out[i]
      if (sample !== undefined && prev !== undefined) out[i] = prev + sample * weight
    }
  }
  return out
}

export type DecodeProgress = (stage: 'decoding' | 'mixing', fraction: number) => void

/**
 * Decode mp3/wav → mono Float32. Validates ext/size/duration.
 * Call from a user gesture; creates a short-lived AudioContext.
 */
export async function decodeFile(file: File, onProgress?: DecodeProgress): Promise<DecodedAudio> {
  validateFileMeta(file)
  onProgress?.('decoding', 0)

  const raw = await file.arrayBuffer()
  // Runtime WebAudio probe (typed as possibly-missing for old browsers).
  const globals = globalThis as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  const Ctx = globals.AudioContext ?? globals.webkitAudioContext
  if (Ctx === undefined) throw new IngestError('decode', 'WebAudio is not available in this browser.')

  const ctx = new Ctx()
  try {
    const buf = await ctx.decodeAudioData(raw)
    onProgress?.('mixing', 0.7)
    if (buf.duration > MAX_DURATION_SEC) {
      throw new IngestError(
        'duration',
        `Audio is ${buf.duration.toFixed(0)} s — limit is ${MAX_DURATION_SEC} s.`,
      )
    }
    const channels: Float32Array[] = []
    for (let c = 0; c < buf.numberOfChannels; c++) {
      channels.push(buf.getChannelData(c).slice())
    }
    const mono = mixToMono(channels, buf.length)
    onProgress?.('mixing', 1)
    return { mono, sampleRate: buf.sampleRate, durationSec: buf.duration, fileName: file.name }
  } catch (err) {
    if (err instanceof IngestError) throw err
    throw new IngestError(
      'decode',
      `Could not decode “${file.name}”. The file may be corrupt or DRM-protected.`,
    )
  } finally {
    void ctx.close().catch(() => undefined)
  }
}

/** Wrap mono samples in an AudioBuffer on the given context (for playback). */
export function monoToAudioBuffer(
  ctx: BaseAudioContext,
  mono: Float32Array,
  sampleRate: number,
): AudioBuffer {
  const buf = ctx.createBuffer(1, mono.length, sampleRate)
  buf.getChannelData(0).set(mono)
  return buf
}
