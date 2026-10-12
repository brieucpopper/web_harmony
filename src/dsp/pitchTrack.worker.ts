// Pitch tracking worker (M2, PRD FR2.1–FR2.3): aubio spectral-YIN per 10 ms
// hop, 50–1200 Hz gate downstream. Runs off the main thread with progress
// posts; the main thread terminates it to cancel. pitchy (MPM) is the
// fallback if the WASM module fails to load — same framing, same gates.
import { ANALYSIS_WINDOW } from '../constants'
import { frameRmsDb, hopSamples, postProcessFrames } from './pitch'
import type { RawPitchFrame } from './pitch'
import type { Frame } from '../types'

export interface PitchTrackStart {
  type: 'start'
  mono: Float32Array
  sampleRate: number
}

export interface PitchTrackCancel {
  type: 'cancel'
}

export type PitchTrackIn = PitchTrackStart | PitchTrackCancel

export type PitchTrackOut =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; frames: Frame[] }
  | { type: 'error'; message: string }

const workerScope = self as unknown as {
  postMessage: (message: PitchTrackOut) => void
  onmessage: ((event: MessageEvent<PitchTrackIn>) => void) | null
}

let cancelled = false

workerScope.onmessage = (event: MessageEvent<PitchTrackIn>): void => {
  const msg = event.data
  if (msg.type === 'cancel') {
    cancelled = true
    return
  }
  cancelled = false
  void run(msg.mono, msg.sampleRate).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : 'Pitch analysis failed.'
    workerScope.postMessage({ type: 'error', message })
  })
}

function postProgress(done: number, total: number): void {
  workerScope.postMessage({ type: 'progress', fraction: Math.min(1, Math.max(0, done / total)) })
}

async function run(mono: Float32Array, sampleRate: number): Promise<void> {
  if (mono.length === 0) throw new Error('Empty audio — nothing to analyze.')
  if (!(sampleRate > 0)) throw new Error('Invalid sample rate.')
  const hop = hopSamples(sampleRate)
  const nFrames = Math.ceil(mono.length / hop)
  const reportEvery = Math.max(1, Math.floor(nFrames / 20))

  let raw: RawPitchFrame[]
  try {
    raw = await trackAubio(mono, sampleRate, hop, nFrames, reportEvery)
  } catch {
    // WASM unavailable (CSP/offline edge) — pitchy MPM fallback, same gates.
    if (cancelled) return
    raw = await trackPitchy(mono, sampleRate, hop, nFrames, reportEvery)
  }
  if (cancelled) return
  workerScope.postMessage({ type: 'done', frames: postProcessFrames(raw) })
}

/**
 * Primary: aubio spectral YIN (`yinfast` — the FFT YIN from the YIN family,
 * ~3× faster than time-domain `yin` at identical accuracy, inside the
 * <2 s / 60 s budget). Aubio keeps its own 1024-sample context and consumes
 * hop-sized frames; the first frames are warmup (confidence 0 → gaps).
 */
async function trackAubio(
  mono: Float32Array,
  sampleRate: number,
  hop: number,
  nFrames: number,
  reportEvery: number,
): Promise<RawPitchFrame[]> {
  const mod = await import('aubiojs')
  const Aubio = await mod.default()
  const pitch = new Aubio.Pitch('yinfast', ANALYSIS_WINDOW, hop, sampleRate)
  const raw: RawPitchFrame[] = new Array<RawPitchFrame>(nFrames)
  const hopBuf = new Float32Array(hop)
  for (let f = 0; f < nFrames; f++) {
    if (cancelled) return raw.slice(0, f)
    const start = f * hop
    const len = Math.min(hop, mono.length - start)
    hopBuf.fill(0)
    hopBuf.set(mono.subarray(start, start + len))
    const f0Hz = pitch.do(hopBuf)
    const conf = pitch.getConfidence()
    raw[f] = { f0Hz, conf, rmsDb: frameRmsDb(hopBuf.subarray(0, len)) }
    if (f % reportEvery === 0) postProgress(f, nFrames)
  }
  postProgress(nFrames, nFrames)
  return raw
}

/** Fallback: pitchy McLeod pitch on 1024-sample windows stepped per hop. */
async function trackPitchy(
  mono: Float32Array,
  sampleRate: number,
  hop: number,
  nFrames: number,
  reportEvery: number,
): Promise<RawPitchFrame[]> {
  const { PitchDetector } = await import('pitchy')
  const detector = PitchDetector.forFloat32Array(ANALYSIS_WINDOW)
  const raw: RawPitchFrame[] = new Array<RawPitchFrame>(nFrames)
  const windowBuf = new Float32Array(ANALYSIS_WINDOW)
  for (let f = 0; f < nFrames; f++) {
    if (cancelled) return raw.slice(0, f)
    const start = f * hop
    windowBuf.fill(0)
    windowBuf.set(mono.subarray(start, Math.min(start + ANALYSIS_WINDOW, mono.length)))
    const [f0Hz, conf] = detector.findPitch(windowBuf, sampleRate)
    const hopLen = Math.min(hop, mono.length - start)
    raw[f] = { f0Hz, conf, rmsDb: frameRmsDb(mono.subarray(start, start + hopLen)) }
    if (f % reportEvery === 0) postProgress(f, nFrames)
  }
  postProgress(nFrames, nFrames)
  return raw
}
