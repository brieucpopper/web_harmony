// Shared constants (PRD §8, FR3–FR4). Single source of truth for DSP + UI math.

/** A=440 fixed, 12-TET only (NFR8). */
export const A440 = 440 as const

/** Piano-roll vertical range C2–C6 (FR3.2). */
export const MIDI_C2 = 36 as const
export const MIDI_C6 = 84 as const
export const NOTE_COUNT = MIDI_C6 - MIDI_C2 + 1 // 48

/** Pitch engine frame hop (FR2.1): 10 ms. */
export const HOP_SEC = 0.01 as const
export const HOP_SAMPLES_AT_44100 = 441 as const
export const ANALYSIS_WINDOW = 1024 as const

/** Voicing thresholds (FR2.2). */
export const VOICED_CONF_THRESHOLD = 0.7 as const
export const VOICED_RMS_DB_THRESHOLD = -40 as const
export const F0_MIN_HZ = 50 as const
export const F0_MAX_HZ = 1200 as const

/** Ingest limits (FR1.3). */
export const MAX_FILE_MB = 20 as const
export const MAX_DURATION_SEC = 120 as const
export const ACCEPTED_EXTENSIONS = ['.mp3', '.wav'] as const
export const ACCEPTED_MIME = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'] as const

/** Theme (UI §4). */
export const COLORS = {
  bg: '#1E2A36',
  header: '#111A23',
  text: '#E6EEF5',
  accent: '#E89A2E',
  gridWhiteKey: '#2A3A4A',
  gridBlackKey: '#22303E',
  beat: '#334455',
  bar: '#4A6076',
  outOfKey: '#EF4444',
} as const

/** Voice palette (FR6.2). Index 0 = white original. */
export const VOICE_COLORS = [
  '#F2F6FA',
  '#4AA8FF',
  '#4ADE80',
  '#C084FC',
  '#FB923C',
] as const
export const MAX_VOICES = 5 as const

/** Viewport defaults + limits (FR3.2). */
export const DEFAULT_PX_PER_SEC = 60 as const
export const MIN_PX_PER_SEC = 5 as const
export const MAX_PX_PER_SEC = 600 as const
export const DEFAULT_PX_PER_NOTE = 16 as const
export const MIN_PX_PER_NOTE = 4 as const
export const MAX_PX_PER_NOTE = 96 as const
export const PIANO_WIDTH_PX = 120 as const

/** Y-axis math: y = (MIDI_C6 - midi) * pxPerNote (FR3.2). */
export function midiToY(midi: number, pxPerNote: number): number {
  return (MIDI_C6 - midi) * pxPerNote
}

export function yToMidi(y: number, pxPerNote: number): number {
  return MIDI_C6 - y / pxPerNote
}

/** X-axis math: x = sec * pxPerSec. */
export function secToX(sec: number, pxPerSec: number): number {
  return sec * pxPerSec
}

export function xToSec(x: number, pxPerSec: number): number {
  return x / pxPerSec
}

/** 12-TET conversions (A=440). */
export function midiToFreq(midi: number): number {
  return A440 * Math.pow(2, (midi - 69) / 12)
}

export function freqToMidiFloat(freqHz: number): number {
  return 69 + 12 * Math.log2(freqHz / A440)
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi)
  const idx = ((rounded % 12) + 12) % 12
  // idx is provably 0..11; the ?? only satisfies noUncheckedIndexedAccess.
  const name = NOTE_NAMES[idx] ?? 'C'
  const octave = Math.floor(rounded / 12) - 1
  return `${name}${octave}`
}

/** Black-key test for piano rendering. */
export function isBlackKey(midi: number): boolean {
  const pc = ((Math.round(midi) % 12) + 12) % 12
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10
}

/** Format mm:ss.mmm for transport readout (FR10.1). */
export function formatTime(sec: number): string {
  const clamped = Math.max(0, sec)
  const m = Math.floor(clamped / 60)
  const s = clamped - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
}
