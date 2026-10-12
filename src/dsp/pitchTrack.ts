// Main-thread pitch-track entry (M2, PRD FR2.6): spawns the WASM worker with
// progress + abort, falls back to a main-thread pitchy run when workers are
// unavailable (tests) or the worker errors (reliability, NFR4).
import { ANALYSIS_WINDOW } from '../constants'
import { IngestError } from './audioUtil'
import { frameRmsDb, hopSamples, postProcessFrames } from './pitch'
import type { RawPitchFrame } from './pitch'
import type { Frame } from '../types'
import type { PitchTrackIn, PitchTrackOut } from './pitchTrack.worker'

export type PitchProgress = (fraction: number) => void

/**
 * Track pitch in the worker. Posts `{mono, sampleRate}` (structured clone —
 * the caller's buffer stays intact for playback) and resolves with per-10 ms
 * frames. Abort terminates the worker and rejects with 'Cancelled.' so the
 * Dropzone cancel path is shared with decode.
 */
export async function trackPitch(
  mono: Float32Array,
  sampleRate: number,
  onProgress?: PitchProgress,
  signal?: AbortSignal,
): Promise<Frame[]> {
  if (signal?.aborted === true) throw new IngestError('decode', 'Cancelled.')
  let worker: Worker | null
  try {
    worker = new Worker(new URL('./pitchTrack.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    worker = null
  }
  if (worker === null) return trackPitchSync(mono, sampleRate, onProgress, signal)

  const active = worker
  return new Promise<Frame[]>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort)
      active.onmessage = null
      active.onerror = null
      active.terminate()
    }
    const onAbort = (): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(new IngestError('decode', 'Cancelled.'))
    }
    const settleSyncFallback = (): void => {
      if (settled) return
      settled = true
      cleanup()
      trackPitchSync(mono, sampleRate, onProgress, signal).then(resolve, reject)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    active.onmessage = (e: MessageEvent<PitchTrackOut>): void => {
      const msg = e.data
      if (msg.type === 'progress') {
        onProgress?.(msg.fraction)
      } else if (msg.type === 'done') {
        if (settled) return
        settled = true
        cleanup()
        resolve(msg.frames)
      } else {
        settleSyncFallback()
      }
    }
    active.onerror = (): void => {
      // Worker failed to boot (CSP/blob edge) — pitchy fallback, same gates.
      settleSyncFallback()
    }
    active.postMessage({ type: 'start', mono, sampleRate } satisfies PitchTrackIn)
  })
}

/**
 * Synchronous-engine fallback / test entry: pitchy MPM on the calling thread,
 * chunked with yields so the UI stays alive on long files. Same hop, same
 * post-processing gates as the worker path.
 */
export async function trackPitchSync(
  mono: Float32Array,
  sampleRate: number,
  onProgress?: PitchProgress,
  signal?: AbortSignal,
): Promise<Frame[]> {
  if (mono.length === 0) throw new Error('Empty audio — nothing to analyze.')
  const { PitchDetector } = await import('pitchy')
  const hop = hopSamples(sampleRate)
  const detector = PitchDetector.forFloat32Array(ANALYSIS_WINDOW)
  const nFrames = Math.ceil(mono.length / hop)
  const raw: RawPitchFrame[] = new Array<RawPitchFrame>(nFrames)
  const windowBuf = new Float32Array(ANALYSIS_WINDOW)
  for (let f = 0; f < nFrames; f++) {
    if (signal?.aborted === true) throw new IngestError('decode', 'Cancelled.')
    const start = f * hop
    windowBuf.fill(0)
    windowBuf.set(mono.subarray(start, Math.min(start + ANALYSIS_WINDOW, mono.length)))
    const [f0Hz, conf] = detector.findPitch(windowBuf, sampleRate)
    const hopLen = Math.min(hop, mono.length - start)
    raw[f] = { f0Hz, conf, rmsDb: frameRmsDb(mono.subarray(start, start + hopLen)) }
    if (f % 50 === 0) {
      onProgress?.(f / nFrames)
      await new Promise<void>((r) => { setTimeout(r, 0); })
    }
  }
  onProgress?.(1)
  return postProcessFrames(raw)
}
