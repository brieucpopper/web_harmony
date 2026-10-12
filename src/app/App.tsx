// App shell (PRD FR3.1): TopBar | VoiceTabs | Dropzone | (corner + Ruler) + (Piano | Canvas | VScroll) | BottomBar.
// Piano and canvas share one row below the ruler so pitch rows stay aligned
// with the keys; the dead corner cell above the piano keeps the x-map exact.
import { useEffect, useRef, useState } from 'react'
import TopBar from './TopBar'
import VoiceTabs from './VoiceTabs'
import Dropzone from './Dropzone'
import PitchCanvas from '../editor/PitchCanvas'
import Piano from '../editor/Piano'
import Ruler, { RULER_H } from '../editor/Ruler'
import Minimap from '../editor/Minimap'
import { useZoomPan } from '../editor/useZoomPan'
import Toast from '../ui/Toast'
import ShortcutsHelp from '../ui/ShortcutsHelp'
import { getEngine } from '../audio/webEngine'
import { monoToAudioBuffer } from '../dsp/audioUtil'
import { loadAutosave } from '../persist/idb'
import { useProjectStore } from '../store/projectStore'
import { useSelectionStore } from '../store/selectionStore'
import { NOTE_COUNT, PIANO_WIDTH_PX } from '../constants'

export default function App(): React.JSX.Element {
  const dirty = useProjectStore((s) => s.dirty)
  const [helpOpen, setHelpOpen] = useState(false)

  // M1 accept: reload → autosave restores buffer (f0 cache arrives in M2).
  useEffect(() => {
    let cancelled = false
    void loadAutosave()
      .then(({ project: saved, audio }) => {
        if (cancelled) return
        // Runtime schema guard: IDB data is untrusted, version widens the `1` literal.
        const schemaVersion: number = saved.version
        if (schemaVersion !== 1) return // corrupt/legacy → keep current (NFR4)
        useProjectStore.getState().restore(
          saved,
          audio !== undefined
            ? {
                mono: audio.mono,
                sampleRate: audio.sampleRate,
                durationSec: audio.mono.length / audio.sampleRate || saved.durationSec,
                fileName: audio.fileName,
              }
            : null,
        )
        if (audio !== undefined) {
          try {
            const engine = getEngine()
            const buf = monoToAudioBuffer(engine.getContext(), audio.mono, audio.sampleRate)
            engine.loadBuffer(buf, audio.mono.length / audio.sampleRate)
          } catch {
            // Engine unavailable — project metadata still restored.
          }
        }
      })
      .catch(() => undefined) // first run: nothing saved yet
    return () => {
      cancelled = true
    }
  }, [])

  // NFR4: guard accidental navigation while dirty.
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => {
      window.removeEventListener('beforeunload', handler)
    }
  }, [dirty])

  // Shortcuts: Space play/pause, S stop, L loop, Esc clear, ? help,
  // Ctrl+0/+/- app zoom (preventDefault locks the browser page-zoom at 100%).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName ?? ''
      // BUTTON: Space/Enter natively clicks the focused button. Handling it
      // globally too double-toggles Play (varies by browser), so let the
      // button own the keypress.
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
      // CANVAS (ruler): Left/Right arrows seek. The global editor handler
      // (M3 chunk moves) must not also fire — the ruler stops propagation,
      // this guard covers the event even if propagation isn't stopped.
      // Space/play and other shortcuts still work when the ruler is focused.
      if (tag === 'CANVAS' && e.key.startsWith('Arrow')) return
      const zoom = useZoomPan.getState()
      if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_')) {
        e.preventDefault()
        if (e.key === '0') zoom.reset()
        else if (e.key === '-' || e.key === '_') zoom.zoomH(-1)
        else zoom.zoomH(1)
        return
      }
      if (e.ctrlKey || e.metaKey) return
      const st = useProjectStore.getState()
      if (e.code === 'Space') {
        e.preventDefault()
        const engine = getEngine()
        if (!engine.hasBuffer()) return
        if (engine.isPlaying()) engine.pause()
        else engine.play()
      } else if (e.key === 's' || e.key === 'S') {
        getEngine().stop()
        st.setPlayhead(0)
      } else if (e.key === 'l' || e.key === 'L') {
        const next = !st.loopAll
        st.setLoopAll(next)
        getEngine().setLoopAll(next)
      } else if (e.key === '?') {
        setHelpOpen(true)
      } else if (e.key === 'Escape') {
        useSelectionStore.getState().clear()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div className="flex h-full flex-col bg-[#1E2A36] text-[#E6EEF5]">
      <TopBar onShowHelp={() => { setHelpOpen(true); }} />
      <VoiceTabs />
      <Dropzone />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Header row: dead corner above the piano + ruler + spacer above VScroll.
            Keeps the piano's first key flush with the canvas's first row. */}
        <div className="flex shrink-0">
          <div
            className="shrink-0 bg-[#111A23]"
            style={{ width: PIANO_WIDTH_PX, height: RULER_H }}
            aria-hidden="true"
          />
          {/* Ruler lives in the canvas column so both share the exact width:
              the playhead triangle and the playhead line use the same x-map. */}
          <div className="min-w-0 flex-1">
            <Ruler />
          </div>
          <div className="w-6 shrink-0 bg-[#111A23]" style={{ height: RULER_H }} aria-hidden="true" />
        </div>
        <div className="flex min-h-0 flex-1">
          <Piano />
          <div className="min-h-0 flex-1">
            <PitchCanvas />
          </div>
          <VScroll />
        </div>
        <BottomBar />
      </div>
      {helpOpen ? <ShortcutsHelp onClose={() => { setHelpOpen(false); }} /> : null}
      <Toast />
    </div>
  )
}

function BottomBar(): React.JSX.Element {
  const pxPerSec = useZoomPan((s) => s.pxPerSec)
  const scrollX = useZoomPan((s) => s.scrollX)
  const scrollY = useZoomPan((s) => s.scrollY)
  const zoomH = useZoomPan((s) => s.zoomH)
  const zoomV = useZoomPan((s) => s.zoomV)
  const resetZoom = useZoomPan((s) => s.reset)
  const setScroll = useZoomPan((s) => s.setScroll)
  const duration = useProjectStore((s) => s.project?.durationSec ?? 0)
  const maxX = Math.max(0, duration * pxPerSec)
  const canScrollX = maxX > 1

  return (
    <div className="flex items-center gap-3 bg-[#111A23] px-2 py-1">
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Horizontal zoom">
        <span className="w-3 text-center text-[10px] font-bold text-[#7d8fa1]" aria-hidden="true">
          H
        </span>
        <button
          type="button"
          onClick={() => { zoomH(-1); }}
          className="rounded bg-[#2A3A4A] px-2"
          aria-label="Zoom out horizontally"
          title="Zoom out horizontally (Ctrl+wheel)"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => { zoomH(1); }}
          className="rounded bg-[#2A3A4A] px-2"
          aria-label="Zoom in horizontally"
          title="Zoom in horizontally (Ctrl+wheel)"
        >
          +
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Vertical zoom">
        <span className="w-3 text-center text-[10px] font-bold text-[#7d8fa1]" aria-hidden="true">
          V
        </span>
        <button
          type="button"
          onClick={() => { zoomV(-1); }}
          className="rounded bg-[#2A3A4A] px-2"
          aria-label="Zoom out vertically"
          title="Zoom out vertically (wheel)"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => { zoomV(1); }}
          className="rounded bg-[#2A3A4A] px-2"
          aria-label="Zoom in vertically"
          title="Zoom in vertically (wheel)"
        >
          +
        </button>
      </div>
      <button
        type="button"
        onClick={resetZoom}
        className="shrink-0 rounded bg-[#2A3A4A] px-2 text-xs"
        aria-label="Reset zoom to 100 percent"
        title="Reset zoom to 100% (Ctrl+0)"
      >
        100%
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.round(maxX))}
        value={canScrollX ? Math.min(Math.round(scrollX), Math.round(maxX)) : 0}
        disabled={!canScrollX}
        onChange={(e) => { setScroll(Number(e.target.value), scrollY); }}
        className="min-w-0 flex-1"
        aria-label="Scroll horizontally"
        title={canScrollX ? 'Scroll horizontally (Shift+wheel)' : 'Load audio to scroll'}
      />
      <div className="w-48 shrink-0">
        <Minimap />
      </div>
    </div>
  )
}

/**
 * Vertical scrollbar as a custom slider: deterministic min-top mapping,
 * no browser vertical-range quirks. Drag the thumb or click the track.
 */
function VScroll(): React.JSX.Element {
  const pxPerNote = useZoomPan((s) => s.pxPerNote)
  const scrollX = useZoomPan((s) => s.scrollX)
  const scrollY = useZoomPan((s) => s.scrollY)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const [viewH, setViewH] = useState(0)

  useEffect(() => {
    const el = trackRef.current
    if (el === null) return
    const update = (): void => { setViewH(el.clientHeight); }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { ro.disconnect(); }
  }, [])

  const contentH = NOTE_COUNT * pxPerNote
  const maxY = Math.max(0, contentH - viewH)
  const clampedY = Math.min(scrollY, maxY)
  const thumbH = contentH <= 0 ? 0 : Math.max(16, Math.min(viewH, (viewH / contentH) * viewH))
  const thumbTop = maxY <= 0 ? 0 : (clampedY / maxY) * (viewH - thumbH)

  const jumpTo = (clientY: number): void => {
    const el = trackRef.current
    if (el === null || viewH <= 0) return
    const rect = el.getBoundingClientRect()
    const frac = (clientY - rect.top) / Math.max(1, rect.height)
    const target = Math.min(maxY, Math.max(0, frac * contentH - viewH / 2))
    useZoomPan.getState().setScroll(scrollX, target)
  }

  const step = (dir: 1 | -1, big: boolean): void => {
    const st = useZoomPan.getState()
    const delta = big ? viewH : st.pxPerNote
    st.setScroll(scrollX, clampedY + dir * delta)
  }

  return (
    <div className="flex w-6 shrink-0 items-stretch bg-[#111A23] py-2 pl-1 pr-2">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Scroll vertically"
        aria-valuemin={0}
        aria-valuemax={Math.round(maxY)}
        aria-valuenow={Math.round(clampedY)}
        className="relative w-full cursor-pointer rounded bg-[#2A3A4A]"
        onPointerDown={(e) => {
          draggingRef.current = true
          ;(e.target as Element).setPointerCapture(e.pointerId)
          jumpTo(e.clientY)
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) jumpTo(e.clientY)
        }}
        onPointerUp={() => {
          draggingRef.current = false
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') step(-1, false)
          else if (e.key === 'ArrowDown') step(1, false)
          else if (e.key === 'PageUp') step(-1, true)
          else if (e.key === 'PageDown') step(1, true)
          else if (e.key === 'Home') useZoomPan.getState().setScroll(scrollX, 0)
          else if (e.key === 'End') useZoomPan.getState().setScroll(scrollX, maxY)
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <div
          className="absolute left-0 w-full rounded bg-[#E89A2E]"
          style={{ top: thumbTop, height: thumbH }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
