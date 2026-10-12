// Pitch post-processing, pure (M2, PRD FR2.2–FR2.3). No React/DOM/Audio/worker
// imports — the worker and the sync fallback share these helpers so Vitest can
// cover the voicing gates, median filter and outlier reject without WASM.
import {
  F0_MAX_HZ,
  F0_MIN_HZ,
  HOP_SEC,
  VOICED_CONF_THRESHOLD,
  VOICED_RMS_DB_THRESHOLD,
  freqToMidiFloat,
  midiToFreq,
} from '../constants'
import type { Frame } from '../types'

/** Raw per-hop measurement before voicing/median decisions. */
export interface RawPitchFrame {
  f0Hz: number
  /** 0–1 pitch clarity (aubio confidence / pitchy clarity). */
  conf: number
  rmsDb: number
}

/** Hop in samples for a sample rate (10 ms, FR2.1). */
export function hopSamples(sampleRate: number): number {
  return Math.max(1, Math.round(sampleRate * HOP_SEC))
}

/** RMS energy of one hop frame in dBFS. Silence floors at −90 dB. */
export function frameRmsDb(frame: ArrayLike<number>): number {
  const n = frame.length
  if (n === 0) return -90
  let sum = 0
  for (let i = 0; i < n; i++) {
    const v = frame[i] ?? 0
    sum += v * v
  }
  const rms = Math.sqrt(sum / n)
  if (rms <= 0) return -90
  return Math.max(-90, 20 * Math.log10(rms))
}

/** Median of a non-trivial list. Empty → 0 (unvoiced sentinel). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0
  const lo = sorted[mid - 1] ?? 0
  const hi = sorted[mid] ?? 0
  return (lo + hi) / 2
}

/**
 * Raw → Frame[] (FR2.2–FR2.3): range-gate 50–1200 Hz, voice if
 * `conf ≥ 0.7 && rms ≥ −40 dB`, MIDI convert, median-5 over voiced frames
 * (±20 ms), Hampel single-frame reject (>200c spike → interpolate).
 * Never auto-tunes beyond smoothing: vibrato survives (median-5 keeps a 5 Hz
 * wobble, only isolated spikes are touched).
 */
export function postProcessFrames(raw: readonly RawPitchFrame[]): Frame[] {
  const n = raw.length
  const midi: number[] = new Array<number>(n)
  const voicedRaw: boolean[] = new Array<boolean>(n)
  for (let i = 0; i < n; i++) {
    const r = raw[i]
    if (r === undefined) {
      midi[i] = 0
      voicedRaw[i] = false
      continue
    }
    const inRange = r.f0Hz >= F0_MIN_HZ && r.f0Hz <= F0_MAX_HZ
    midi[i] = inRange ? freqToMidiFloat(r.f0Hz) : 0
    voicedRaw[i] = inRange && r.conf >= VOICED_CONF_THRESHOLD && r.rmsDb >= VOICED_RMS_DB_THRESHOLD
  }

  // Median-5 over voiced neighbours only (gaps never bleed pitch across).
  const smooth: number[] = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const isVoiced = voicedRaw[i] ?? false
    if (!isVoiced) {
      smooth[i] = 0
      continue
    }
    const window: number[] = []
    for (let j = i - 2; j <= i + 2; j++) {
      if (j < 0 || j >= n) continue
      if ((voicedRaw[j] ?? false) && (midi[j] ?? 0) !== 0) window.push(midi[j] ?? 0)
    }
    smooth[i] = window.length > 0 ? median(window) : (midi[i] ?? 0)
  }

  // Hampel: a lone frame >200c (2 semitones) from BOTH voiced neighbours is a
  // tracking glitch — interpolate instead of letting it split a note later.
  for (let i = 1; i < n - 1; i++) {
    if (!(voicedRaw[i] ?? false)) continue
    if (!(voicedRaw[i - 1] ?? false) || !(voicedRaw[i + 1] ?? false)) continue
    const prev = smooth[i - 1] ?? 0
    const cur = smooth[i] ?? 0
    const next = smooth[i + 1] ?? 0
    if (Math.abs(cur - prev) > 2 && Math.abs(cur - next) > 2) {
      smooth[i] = (prev + next) / 2
    }
  }

  const frames: Frame[] = new Array<Frame>(n)
  for (let i = 0; i < n; i++) {
    const r = raw[i]
    const isVoiced = voicedRaw[i] ?? false
    const m = smooth[i] ?? 0
    if (r === undefined || !isVoiced) {
      frames[i] = {
        f0Hz: r?.f0Hz ?? 0,
        midiFloat: 0,
        conf: r?.conf ?? 0,
        rmsDb: r?.rmsDb ?? -90,
        voiced: false,
      }
    } else {
      frames[i] = {
        f0Hz: midiToFreq(m),
        midiFloat: m,
        conf: r.conf,
        rmsDb: r.rmsDb,
        voiced: true,
      }
    }
  }
  return frames
}
