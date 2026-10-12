// Piano-roll canvas, v1 (PRD FR3). Single Canvas2D + DPR + continuous RAF loop.
// Render loop and input listeners are mount-once: every frame reads the
// stores via getState(), so wheel/zoom ticks never tear down the loop or
// re-render React (smooth pan/zoom, drag state survives in a ref).
// M0/M1 content: grid + waveform + demo chunks. Editing lands in M3.
import { useEffect, useRef } from 'react'
import {
  COLORS,
  MIDI_C2,
  NOTE_COUNT,
  isBlackKey,
  midiToNoteName,
  midiToY,
  secToX,
} from '../constants'
import { getEngine } from '../audio/webEngine'
import { useProjectStore } from '../store/projectStore'
import { useSelectionStore } from '../store/selectionStore'
import { pitchClass, scaleSet } from '../dsp/theory'
import { routeWheel, useZoomPan } from './useZoomPan'
import type { Chunk } from '../types'

/** M0 demo: 2 hardcoded chunks proving Y/X math before M2 analysis exists. */
const DEMO_CHUNKS: Array<Pick<Chunk, 'id' | 'startSec' | 'endSec' | 'baseMidi' | 'curve'>> = [
  {
    id: 'demo-1',
    startSec: 1.0,
    endSec: 2.0,
    baseMidi: 64, // E4
    curve: Array.from({ length: 100 }, (_, i) => 64 + 0.4 * Math.sin((i / 100) * Math.PI * 6)),
  },
  {
    id: 'demo-2',
    startSec: 2.4,
    endSec: 3.2,
    baseMidi: 67, // G4
    curve: Array.from({ length: 80 }, (_, i) => 67 + 0.25 * Math.sin((i / 80) * Math.PI * 4)),
  },
]

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

interface MidDrag {
  startX: number
  startY: number
  scrollX: number
  scrollY: number
}

interface ChunkDrawView {
  pxPerSec: number
  pxPerNote: number
  scrollX: number
  scrollY: number
  cssW: number
}

// Hoisted outside the RAF callback (perf): defining this inside draw() at
// 60fps allocates ~30k closures/sec at 500 chunks. Module-level instead.
// Alignment: row top = midiToY(base) so a chunk fills its piano row exactly
// (Piano key for M spans [midiToY(M), midiToY(M)+ppN], same as the grid row).
// Pitch lines sit at row center: midiToY(pitch) + ppN/2.
function drawChunk(
  ctx: CanvasRenderingContext2D,
  view: ChunkDrawView,
  startSec: number,
  endSec: number,
  baseMidi: number,
  curve: readonly number[],
  fill: string,
  border: string,
  borderW: number,
): void {
  const { pxPerSec, pxPerNote, scrollX, scrollY, cssW } = view
  const x = secToX(startSec, pxPerSec) - scrollX
  const w = Math.max(3, secToX(endSec, pxPerSec) - secToX(startSec, pxPerSec))
  if (x + w < 0 || x > cssW) return
  const top = midiToY(baseMidi, pxPerNote) - scrollY
  const h = Math.max(4, pxPerNote)
  ctx.fillStyle = fill
  ctx.strokeStyle = border
  ctx.lineWidth = borderW
  roundRect(ctx, x, top, w, h, 4)
  ctx.fill()
  ctx.stroke()
  // Orange pitch curve (rigid shape preserved, PRD §1.2.3)
  if (curve.length > 1) {
    ctx.strokeStyle = COLORS.accent
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < curve.length; i++) {
      const t = startSec + i * 0.01
      const cx = secToX(t, pxPerSec) - scrollX
      const cy = midiToY(curve[i] ?? baseMidi, pxPerNote) + pxPerNote / 2 - scrollY
      if (i === 0) ctx.moveTo(cx, cy)
      else ctx.lineTo(cx, cy)
    }
    ctx.stroke()
  }
}

export default function PitchCanvas(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  // Ref, not effect-closure state: survives the (now rare) effect re-runs.
  const midDragRef = useRef<MidDrag | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (canvas === null || wrap === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    let raf = 0
    let cssW = 0
    let cssH = 0
    let disposed = false

    const resize = (): void => {
      const rect = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      cssW = Math.max(1, rect.width)
      cssH = Math.max(1, rect.height)
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    // Wheel input must be non-passive: we preventDefault every wheel event so
    // the browser never page-zooms or scrolls (page zoom locked at 100%).
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const st = useZoomPan.getState()
      routeWheel(e, e.clientX - rect.left, e.clientY - rect.top, st, {
        zoomHAt: (x, f) => {
          st.zoomHAt(x, f)
        },
        zoomVAt: (y, f) => {
          st.zoomVAt(y, f)
        },
        setScroll: (x, y) => {
          st.setScroll(x, y)
        },
      })
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })

    // Middle-drag pans both axes (also blocks the browser autoscroll).
    // M3 adds marquee-select on left-drag here.
    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 1) return
      e.preventDefault()
      const st = useZoomPan.getState()
      midDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        scrollX: st.scrollX,
        scrollY: st.scrollY,
      }
      wrap.style.cursor = 'grabbing'
    }
    const onPointerMove = (e: PointerEvent): void => {
      const drag = midDragRef.current
      if (drag === null) return
      useZoomPan
        .getState()
        .setScroll(drag.scrollX - (e.clientX - drag.startX), drag.scrollY - (e.clientY - drag.startY))
    }
    const onPointerUp = (): void => {
      midDragRef.current = null
      wrap.style.cursor = ''
    }
    wrap.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)

    const draw = (): void => {
      raf = 0
      if (disposed || document.hidden) return
      const project = useProjectStore.getState().project
      const audio = useProjectStore.getState().audio
      const selectedIds = useSelectionStore.getState().selectedIds
      const { pxPerSec, pxPerNote, scrollX, scrollY } = useZoomPan.getState()
      const engine = getEngine()

      ctx.fillStyle = COLORS.bg
      ctx.fillRect(0, 0, cssW, cssH)

      // --- Pitch rows C2..C6 ---
      // Key highlight (FR7.2): out-of-scale rows dimmed to ~45% brightness
      // via a header-bg overlay. Scale set is built once per frame.
      // Alignment: row top = midiToY(midi) so the row fills the piano key
      // for the same MIDI exactly (see drawChunk above).
      const inScale =
        project !== null && project.highlightKey ? scaleSet(project.key) : null
      for (let row = 0; row < NOTE_COUNT; row++) {
        const midi = MIDI_C2 + row
        const y = midiToY(midi, pxPerNote) - scrollY
        const h = pxPerNote
        if (y + h < 0 || y > cssH) continue
        ctx.fillStyle = isBlackKey(midi) ? COLORS.gridBlackKey : COLORS.gridWhiteKey
        ctx.fillRect(0, y, cssW, h)
        if (inScale !== null && !inScale.has(pitchClass(midi))) {
          ctx.fillStyle = 'rgba(17,26,35,0.55)'
          ctx.fillRect(0, y, cssW, h)
        }
        ctx.fillStyle = '#0d141c'
        ctx.fillRect(0, y + h - 1, cssW, 1)
        if (!isBlackKey(midi) && pxPerNote >= 12) {
          ctx.fillStyle = '#7d8fa1'
          ctx.font = '10px Inter, system-ui, sans-serif'
          ctx.fillText(midiToNoteName(midi), 6, y + h - 4)
        }
      }

      // --- Time grid (beats thin / bars thick) ---
      const bpm = project?.bpm ?? 120
      const showGrid = project?.showGrid ?? true
      if (showGrid) {
        const beatDur = 60 / bpm
        const t0 = scrollX / pxPerSec
        const t1 = (scrollX + cssW) / pxPerSec
        const firstBeat = Math.floor(t0 / beatDur)
        const lastBeat = Math.ceil(t1 / beatDur)
        for (let b = firstBeat; b <= lastBeat; b++) {
          const t = b * beatDur
          const x = Math.round(secToX(t, pxPerSec) - scrollX) + 0.5
          const isBar = b % 4 === 0
          ctx.strokeStyle = isBar ? COLORS.bar : COLORS.beat
          ctx.lineWidth = isBar ? 1.5 : 1
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, cssH)
          ctx.stroke()
        }
      }

      // --- Waveform preview (M1 accept) ---
      const mono = audio?.mono
      if (mono !== undefined && audio !== null) {
        ctx.strokeStyle = 'rgba(143,163,184,0.65)'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let px = 0; px < cssW; px++) {
          const t = (px + scrollX) / pxPerSec
          const idx = Math.floor((t / audio.durationSec) * mono.length)
          if (idx < 0 || idx >= mono.length) continue
          const v = mono[idx] ?? 0
          const mid = cssH * 0.5
          const amp = Math.min(mid - 2, Math.abs(v) * mid)
          ctx.moveTo(px + 0.5, mid - amp)
          ctx.lineTo(px + 0.5, mid + amp)
        }
        ctx.stroke()
      }

      // --- Chunks: real voices (M2+) or M0 demo pair ---
      const view: ChunkDrawView = { pxPerSec, pxPerNote, scrollX, scrollY, cssW }

      if (project !== null) {
        for (const voice of project.voices) {
          // M4: dim inactive voices to 55%.
          for (const ch of voice.chunks) {
            const selected = selectedIds.includes(ch.id)
            drawChunk(
              ctx,
              view,
              ch.startSec,
              ch.endSec,
              ch.baseMidi,
              ch.curve,
              `${voice.color}4D`, // 30% fill
              selected ? '#FFFFFF' : voice.color,
              selected ? 2.5 : 1.5,
            )
          }
        }
      } else {
        for (const d of DEMO_CHUNKS) {
          drawChunk(ctx, view, d.startSec, d.endSec, d.baseMidi, d.curve, '#F2F6FA4D', '#F2F6FA', 1.5)
        }
        ctx.fillStyle = '#7d8fa1'
        ctx.font = '11px Inter, system-ui, sans-serif'
        ctx.fillText('DEMO — upload audio to replace (M1)', 8, 16)
      }

      // --- Playhead ---
      if (audio !== null) {
        const px = secToX(engine.getPlayhead(), pxPerSec) - scrollX
        if (px >= 0 && px <= cssW) {
          ctx.strokeStyle = COLORS.accent
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(px, 0)
          ctx.lineTo(px, cssH)
          ctx.stroke()
        }
      }

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    // Idle saving: pause the loop while the tab is hidden, resume on visible.
    const onVisibility = (): void => {
      if (disposed) return
      if (document.hidden) {
        if (raf !== 0) {
          cancelAnimationFrame(raf)
          raf = 0
        }
      } else if (raf === 0) {
        raf = requestAnimationFrame(draw)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      disposed = true
      if (raf !== 0) cancelAnimationFrame(raf)
      raf = 0
      document.removeEventListener('visibilitychange', onVisibility)
      ro.disconnect()
      wrap.removeEventListener('wheel', onWheel)
      wrap.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [])

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden"
      data-testid="pitch-canvas-wrap"
    >
      <canvas ref={canvasRef} className="block" aria-label="Piano roll: pitch versus time" />
    </div>
  )
}
