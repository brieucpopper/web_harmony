// Piano strip, 120 px fixed (PRD FR3.6). DOM buttons = keyboard-accessible (NFR6).
// Click previews a sampled piano note (public/piano/*.mp3, fuhton/piano-mp3);
// sine synthesis is the offline/failure fallback.
// Keys are memoized on pxPerNote so vertical scroll ticks only move a transform.
import { useCallback, useMemo } from 'react'
import { MIDI_C2, MIDI_C6, NOTE_COUNT, PIANO_WIDTH_PX, isBlackKey, midiToFreq, midiToNoteName } from '../constants'
import { getEngine } from '../audio/webEngine'
import { isInScale } from '../dsp/theory'
import { useProjectStore } from '../store/projectStore'
import { useZoomPan } from './useZoomPan'

export function previewSine(midi: number, seconds = 0.4): void {
  try {
    const engine = getEngine()
    const ctx = engine.getContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = midiToFreq(midi)
    const t = ctx.currentTime
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + seconds + 0.05)
  } catch {
    // Audio unavailable (SSR/tests) — preview is best-effort.
  }
}

// Sample file per MIDI note (flat spelling matches the piano-mp3 asset set).
const SAMPLE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const

export function midiToSampleFile(midi: number): string {
  const rounded = Math.max(MIDI_C2, Math.min(MIDI_C6, Math.round(midi)))
  const pc = ((rounded % 12) + 12) % 12
  const name = SAMPLE_NAMES[pc] ?? 'C'
  const octave = Math.floor(rounded / 12) - 1
  return `${name}${octave}.mp3`
}

const sampleCache = new Map<number, AudioBuffer>()
const sampleInflight = new Map<number, Promise<AudioBuffer | null>>()

async function loadSample(midi: number): Promise<AudioBuffer | null> {
  const cached = sampleCache.get(midi)
  if (cached !== undefined) return cached
  const inflight = sampleInflight.get(midi)
  if (inflight !== undefined) return inflight
  const task = (async (): Promise<AudioBuffer | null> => {
    try {
      const engine = getEngine()
      const ctx = engine.getContext()
      const res = await fetch(`${import.meta.env.BASE_URL}piano/${midiToSampleFile(midi)}`)
      if (!res.ok) return null
      const buf = await ctx.decodeAudioData(await res.arrayBuffer())
      sampleCache.set(midi, buf)
      return buf
    } catch {
      return null
    } finally {
      sampleInflight.delete(midi)
    }
  })()
  sampleInflight.set(midi, task)
  return task
}

/** Click preview: sampled piano note, sine fallback when offline/failed. */
export function previewPiano(midi: number): void {
  void (async (): Promise<void> => {
    try {
      const buf = await loadSample(midi)
      if (buf === null) {
        previewSine(midi)
        return
      }
      const engine = getEngine()
      const ctx = engine.getContext()
      const src = ctx.createBufferSource()
      src.buffer = buf
      const gain = ctx.createGain()
      gain.gain.value = 0.8
      src.connect(gain)
      gain.connect(ctx.destination)
      src.start()
    } catch {
      previewSine(midi)
    }
  })()
}

export default function Piano(): React.JSX.Element {
  const pxPerNote = useZoomPan((s) => s.pxPerNote)
  const scrollY = useZoomPan((s) => s.scrollY)
  // Key tint follows the canvas row highlight; identity-stable selectors
  // avoid re-renders on unrelated project edits (e.g. BPM typing).
  const keySig = useProjectStore((s) => s.project?.key)
  const highlightKey = useProjectStore((s) => s.project?.highlightKey !== false)

  const onKey = useCallback((midi: number) => {
    previewPiano(midi)
  }, [])

  const keys = useMemo(() => {
    // Highlight mode: ignore the traditional black/white piano look entirely —
    // only 2 colors (white = in key, gray = out of key), all keys full width.
    // Falls back to the classic piano scheme when highlight is off or with
    // no project loaded (nothing to highlight against).
    const useKeyColors = highlightKey && keySig !== undefined
    const els: React.JSX.Element[] = []
    for (let row = 0; row < NOTE_COUNT; row++) {
      const midi = MIDI_C6 - row
      const black = isBlackKey(midi)
      const label = midiToNoteName(midi)
      const showLabel = label.startsWith('C')
      const inKey = !highlightKey || keySig === undefined || isInScale(midi, keySig)
      const tone = useKeyColors
        ? inKey
          ? 'bg-[#e8edf2] text-[#334455] hover:bg-white'
          : 'bg-[#9aa7b4] text-[#334455] hover:bg-[#b9c4cf]'
        : black
          ? 'bg-[#0d141c] text-[#7d8fa1]'
          : 'bg-[#e8edf2] text-[#334455] hover:bg-white'
      const width = useKeyColors ? PIANO_WIDTH_PX : black ? 72 : PIANO_WIDTH_PX
      els.push(
        <button
          key={midi}
          type="button"
          aria-label={`Preview ${label}`}
          title={label}
          onClick={() => {
            onKey(midi)
          }}
          className={`flex items-center border-b border-[#0d141c] px-1 text-[9px] ${tone}`}
          style={{ height: pxPerNote, width }}
        >
          {showLabel ? label : ''}
        </button>,
      )
    }
    return els
  }, [pxPerNote, onKey, keySig, highlightKey])

  return (
    <div
      className="shrink-0 overflow-hidden bg-[#111A23]"
      style={{ width: PIANO_WIDTH_PX }}
      role="group"
      aria-label="Piano pitch axis, C2 to C6"
    >
      <div style={{ transform: `translateY(${-scrollY}px)` }}>{keys}</div>
    </div>
  )
}
