// Piano-roll canvas (PRD FR3–FR5). Single Canvas2D + DPR + continuous RAF loop.
// Render loop and input listeners are mount-once: every frame reads the
// stores via getState(), so wheel/zoom ticks never tear down the loop or
// re-render React (smooth pan/zoom, drag state survives in a ref).
// M3 editing: click / Shift-click / marquee select, drag move (ghost +
// tooltip), right-edge trim, cut-tool split. Mutations go through the
// project store (undoable); the drag preview lives in a ref until mouseup.
import { useEffect, useRef } from 'react'
import {
  COLORS,
  MIDI_C2,
  MIDI_C6,
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
import { hitTest, marqueeSelect } from './tools/select'
import { clampMoveDeltas, deltasFromPixels, keyboardDelta, snapDeltaToGrid } from './tools/move'
import { locateChunk, trimChunkEnd } from './tools/cut'
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

/** M3 pointer gesture, held in a ref (never React state — 60 fps drag). */
type Drag =
  | {
      kind: 'move'
      ids: string[]
      originStart: number
      startX: number
      startY: number
      dMidi: number
      dSec: number
      tipX: number
      tipY: number
    }
  | { kind: 'trim'; id: string; origEnd: number; newEnd: number; tipX: number; tipY: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; additive: boolean }

/** Marquee smaller than this is a plain empty click (clears selection). */
const MARQUEE_MIN_PX = 4 as const

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

/** Floating drag readout, e.g. `E4 (+7st) @ 12.34s` (PRD §4). */
function drawTooltip(
  ctx: CanvasRenderingContext2D,
  text: string,
  tipX: number,
  tipY: number,
  cssW: number,
): void {
  ctx.font = '11px Inter, system-ui, sans-serif'
  const w = ctx.measureText(text).width + 12
  const x = Math.min(Math.max(4, tipX + 12), Math.max(4, cssW - w - 4))
  const y = Math.max(4, tipY - 30)
  ctx.fillStyle = COLORS.header
  ctx.strokeStyle = COLORS.accent
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.rect(x, y, w, 20)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = COLORS.text
  ctx.fillText(text, x + 6, y + 14)
}

export default function PitchCanvas(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  // Ref, not effect-closure state: survives the (now rare) effect re-runs.
  const midDragRef = useRef<MidDrag | null>(null)
  const dragRef = useRef<Drag | null>(null)

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
    // Left-drag edits: cut split, body move, right-edge trim, marquee.
    const contentPoint = (clientX: number, clientY: number): { sec: number; midi: number; relX: number; relY: number } => {
      const rect = canvas.getBoundingClientRect()
      const st = useZoomPan.getState()
      const relX = clientX - rect.left
      const relY = clientY - rect.top
      return {
        sec: (relX + st.scrollX) / st.pxPerSec,
        midi: MIDI_C6 - (relY + st.scrollY) / st.pxPerNote,
        relX,
        relY,
      }
    }
    const onPointerDown = (e: PointerEvent): void => {
      if (e.button === 1) {
        e.preventDefault()
        const st = useZoomPan.getState()
        midDragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          scrollX: st.scrollX,
          scrollY: st.scrollY,
        }
        wrap.style.cursor = 'grabbing'
        return
      }
      if (e.button !== 0) return
      // Focus for arrow-key moves (FR4.5); the wrap owns Delete/arrows.
      wrap.focus({ preventScroll: true })
      const project = useProjectStore.getState().project
      if (project === null) return // demo mode: no editing
      const pt = contentPoint(e.clientX, e.clientY)
      const st = useZoomPan.getState()
      if (useSelectionStore.getState().tool === 'cut') {
        const hit = hitTest(project.voices, pt.sec, pt.midi, st)
        if (hit !== undefined) useProjectStore.getState().splitChunk(hit.chunk.id, pt.sec)
        return
      }
      const hit = hitTest(project.voices, pt.sec, pt.midi, st)
      if (hit !== undefined && hit.edge === 'right') {
        useSelectionStore.getState().selectOnly(hit.chunk.id)
        dragRef.current = {
          kind: 'trim',
          id: hit.chunk.id,
          origEnd: hit.chunk.endSec,
          newEnd: hit.chunk.endSec,
          tipX: pt.relX,
          tipY: pt.relY,
        }
        wrap.style.cursor = 'ew-resize'
        return
      }
      if (hit !== undefined) {
        const sel = useSelectionStore.getState()
        if (e.shiftKey) sel.toggleAdd(hit.chunk.id)
        else if (!sel.selectedIds.includes(hit.chunk.id)) sel.selectOnly(hit.chunk.id)
        dragRef.current = {
          kind: 'move',
          ids: useSelectionStore.getState().selectedIds,
          originStart: hit.chunk.startSec,
          startX: e.clientX,
          startY: e.clientY,
          dMidi: 0,
          dSec: 0,
          tipX: pt.relX,
          tipY: pt.relY,
        }
        wrap.style.cursor = 'move'
        return
      }
      dragRef.current = { kind: 'marquee', x0: pt.relX, y0: pt.relY, x1: pt.relX, y1: pt.relY, additive: e.shiftKey }
    }
    const hoverCursor = (e: PointerEvent): void => {
      const project = useProjectStore.getState().project
      if (project === null) {
        wrap.style.cursor = ''
        return
      }
      if (useSelectionStore.getState().tool === 'cut') {
        wrap.style.cursor = 'crosshair'
        return
      }
      const pt = contentPoint(e.clientX, e.clientY)
      const hit = hitTest(project.voices, pt.sec, pt.midi, useZoomPan.getState())
      if (hit === undefined) wrap.style.cursor = ''
      else wrap.style.cursor = hit.edge === 'right' ? 'ew-resize' : 'move'
    }
    const onPointerMove = (e: PointerEvent): void => {
      const mid = midDragRef.current
      if (mid !== null) {
        useZoomPan
          .getState()
          .setScroll(mid.scrollX - (e.clientX - mid.startX), mid.scrollY - (e.clientY - mid.startY))
        return
      }
      const drag = dragRef.current
      if (drag === null) {
        hoverCursor(e)
        return
      }
      const project = useProjectStore.getState().project
      if (project === null) {
        dragRef.current = null
        return
      }
      const pt = contentPoint(e.clientX, e.clientY)
      const st = useZoomPan.getState()
      if (drag.kind === 'move') {
        const raw = deltasFromPixels(e.clientX - drag.startX, e.clientY - drag.startY, st.pxPerSec, st.pxPerNote)
        const sec = project.snapToGrid
          ? snapDeltaToGrid(drag.originStart, raw.dSec, 60 / project.bpm)
          : raw.dSec
        const clamped = clampMoveDeltas(project.voices, drag.ids, raw.dMidi, sec)
        drag.dMidi = clamped.dMidi
        drag.dSec = clamped.dSec
        drag.tipX = pt.relX
        drag.tipY = pt.relY
      } else if (drag.kind === 'trim') {
        const found = locateChunk(project.voices, drag.id)
        drag.newEnd = found === undefined
          ? drag.origEnd
          : trimChunkEnd(found.chunk, pt.sec, found.nextStartSec).endSec
        drag.tipX = pt.relX
        drag.tipY = pt.relY
      } else {
        drag.x1 = pt.relX
        drag.y1 = pt.relY
      }
    }
    const onPointerUp = (): void => {
      if (midDragRef.current !== null) {
        midDragRef.current = null
        wrap.style.cursor = ''
        return
      }
      const drag = dragRef.current
      dragRef.current = null
      wrap.style.cursor = ''
      if (drag === null) return
      const store = useProjectStore.getState()
      const project = store.project
      if (project === null) return
      if (drag.kind === 'move') {
        if (drag.dMidi !== 0 || drag.dSec !== 0) store.moveChunks(drag.ids, drag.dMidi, drag.dSec)
      } else if (drag.kind === 'trim') {
        if (drag.newEnd !== drag.origEnd) store.trimChunk(drag.id, drag.newEnd)
      } else {
        const st = useZoomPan.getState()
        const small =
          Math.abs(drag.x1 - drag.x0) < MARQUEE_MIN_PX && Math.abs(drag.y1 - drag.y0) < MARQUEE_MIN_PX
        const sel = useSelectionStore.getState()
        if (small) {
          if (!drag.additive) sel.clear()
          return
        }
        const t0 = (Math.min(drag.x0, drag.x1) + st.scrollX) / st.pxPerSec
        const t1 = (Math.max(drag.x0, drag.x1) + st.scrollX) / st.pxPerSec
        const mHi = MIDI_C6 - (Math.min(drag.y0, drag.y1) + st.scrollY) / st.pxPerNote
        const mLo = MIDI_C6 - (Math.max(drag.y0, drag.y1) + st.scrollY) / st.pxPerNote
        const ids = marqueeSelect(project.voices, t0, t1, mLo, mHi)
        if (drag.additive) sel.selectMany([...new Set([...sel.selectedIds, ...ids])])
        else sel.selectMany(ids)
      }
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

      // --- Waveform preview (M1 accept; hiding via the Wave toggle) ---
      const mono = audio?.mono
      const showWaveform = project?.showWaveform !== false
      if (showWaveform && mono !== undefined && audio !== null) {
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

      // --- M3 drag preview: ghost + marquee + tooltip (no store writes) ---
      const gesture = dragRef.current
      if (gesture !== null && project !== null) {
        if (gesture.kind === 'move' && (gesture.dMidi !== 0 || gesture.dSec !== 0)) {
          ctx.save()
          ctx.setLineDash([6, 4])
          ctx.strokeStyle = '#FFFFFF'
          ctx.lineWidth = 1.5
          for (const voice of project.voices) {
            for (const ch of voice.chunks) {
              if (!gesture.ids.includes(ch.id)) continue
              const x = secToX(ch.startSec + gesture.dSec, pxPerSec) - scrollX
              const w = Math.max(3, secToX(ch.endSec + gesture.dSec, pxPerSec) - secToX(ch.startSec + gesture.dSec, pxPerSec))
              if (x + w < 0 || x > cssW) continue
              roundRect(ctx, x, midiToY(ch.baseMidi + gesture.dMidi, pxPerNote) - scrollY, w, Math.max(4, pxPerNote), 4)
              ctx.stroke()
            }
          }
          ctx.restore()
          const primary = gesture.ids
            .map((id) => {
              for (const v of project.voices) {
                const c = v.chunks.find((k) => k.id === id)
                if (c !== undefined) return c
              }
              return undefined
            })
            .find((c) => c !== undefined)
          if (primary !== undefined) {
            const multi = gesture.ids.length > 1 ? `${String(gesture.ids.length)}× ` : ''
            const sign = gesture.dMidi >= 0 ? '+' : ''
            drawTooltip(
              ctx,
              `${multi}${midiToNoteName(primary.baseMidi + gesture.dMidi)} (${sign}${String(gesture.dMidi)}st) @ ${(primary.startSec + gesture.dSec).toFixed(2)}s`,
              gesture.tipX,
              gesture.tipY,
              cssW,
            )
          }
        } else if (gesture.kind === 'trim') {
          const found = locateChunk(project.voices, gesture.id)
          if (found !== undefined && gesture.newEnd !== gesture.origEnd) {
            const x = secToX(gesture.newEnd, pxPerSec) - scrollX
            ctx.save()
            ctx.setLineDash([6, 4])
            ctx.strokeStyle = '#FFFFFF'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.moveTo(x, 0)
            ctx.lineTo(x, cssH)
            ctx.stroke()
            ctx.restore()
            drawTooltip(
              ctx,
              `${gesture.newEnd.toFixed(2)}s · ${String(Math.round((gesture.newEnd - found.chunk.startSec) * 1000))}ms`,
              gesture.tipX,
              gesture.tipY,
              cssW,
            )
          }
        } else if (gesture.kind === 'marquee') {
          const x = Math.min(gesture.x0, gesture.x1)
          const y = Math.min(gesture.y0, gesture.y1)
          const w = Math.abs(gesture.x1 - gesture.x0)
          const h = Math.abs(gesture.y1 - gesture.y0)
          ctx.fillStyle = 'rgba(232,154,46,0.12)'
          ctx.fillRect(x, y, w, h)
          ctx.save()
          ctx.setLineDash([4, 3])
          ctx.strokeStyle = COLORS.accent
          ctx.lineWidth = 1
          ctx.strokeRect(x + 0.5, y + 0.5, w, h)
          ctx.restore()
        }
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
      tabIndex={0}
      role="application"
      aria-label="Piano roll editor: click notes to select, arrows to move, Delete to remove"
      className="relative h-full w-full overflow-hidden focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E89A2E]"
      data-testid="pitch-canvas-wrap"
      onKeyDown={(e) => {
        const project = useProjectStore.getState().project
        if (project === null) return
        const sel = useSelectionStore.getState()
        if (e.key.startsWith('Arrow')) {
          // Ruler owns arrows for seek; the editor owns them for chunk moves.
          // Stop propagation so the global handler never double-fires.
          if (sel.selectedIds.length === 0) return
          e.preventDefault()
          e.stopPropagation()
          const dir = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'up' : 'down'
          const d = keyboardDelta(dir, e.shiftKey, project.snapToGrid, project.bpm)
          useProjectStore.getState().moveChunks(sel.selectedIds, d.dMidi, d.dSec)
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          if (sel.selectedIds.length === 0) return
          e.preventDefault()
          e.stopPropagation()
          useProjectStore.getState().deleteChunks(sel.selectedIds)
        }
      }}
    >
      <canvas ref={canvasRef} className="block" aria-label="Piano roll: pitch versus time" />
    </div>
  )
}
