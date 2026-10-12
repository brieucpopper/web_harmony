// Data model (PRD §5). DSP + store + persist share these types.

export type VoiceId = string

export interface Frame {
  f0Hz: number
  midiFloat: number
  conf: number
  rmsDb: number
  voiced: boolean
}

export interface Chunk {
  id: string
  voiceId: VoiceId
  startSec: number
  endSec: number
  /** Snapped center, int 36..84. */
  baseMidi: number
  /** Avg deviation at creation, cents. */
  centsOffset: number
  /** Natural midiFloat trajectory, 1 entry per 10 ms. */
  curve: number[]
  /** Center at segmentation time (for delta calc). */
  origBaseMidi: number
  /** Post-segmentation curve copy (for Reset). */
  pristineCurve: number[]
  /** Fine tune from Advanced Edit modal, ±50c. M5; default 0. */
  fineCents: number
}

export interface Voice {
  id: VoiceId
  name: string
  color: string
  mute: boolean
  solo: boolean
  /** 0–1.5, default 1.0 (FR6.3). */
  volume: number
  chunks: Chunk[]
}

export interface KeySignature {
  /** Pitch class 0–11 (C=0). */
  root: number
  mode: 'major' | 'minor'
}

export interface Project {
  version: 1
  name: string
  durationSec: number
  bpm: number
  key: KeySignature
  magnet: boolean
  showGrid: boolean
  snapToGrid: boolean
  /** Tint pitch rows by key membership (FR7.2). Default true. */
  highlightKey: boolean
  voices: Voice[]
  /** Full pitch-track cache (skips re-analysis on reload). Empty until M2. */
  f0: Frame[]
  sampleRate: number
}

export type ProjectStatus =
  | 'empty'
  | 'decoding'
  | 'analyzing'
  | 'segmenting'
  | 'ready'
  | 'error'

export function emptyProject(name: string): Project {
  return {
    version: 1,
    name,
    durationSec: 0,
    bpm: 120,
    key: { root: 0, mode: 'major' },
    magnet: false,
    showGrid: true,
    snapToGrid: false,
    highlightKey: true,
    voices: [],
    f0: [],
    sampleRate: 44100,
  }
}
