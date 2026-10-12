// Time ruler (PRD FR3.5, FR8.3): bar.beat + seconds, click-to-seek (M1).
// Mount-once RAF loop reading stores per frame — zoom/scroll ticks never
// tear it down. Must share the canvas column width so x-maps align exactly.
import { useEffect, useRef } from 'react'
import { COLORS, secToX } from '../constants'
import { getEngine } from '../audio/webEngine'
import { useProjectStore } from '../store/projectStore'
import { useZoomPan } from './useZoomPan'

export const RULER_H = 28 as const

export function seekFromClientX(clientX: number, el: Element): void {
  const rect = el.getBoundingClientRect()
  const { pxPerSec, scrollX } = useZoomPan.getState()
  const sec = (clientX - rect.left + scrollX) / pxPerSec
  getEngine().seek(sec)
  useProjectStore.getState().setPlayhead(getEngine().getPlayhead())
}

export default function Ruler(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  // Duration only feeds aria bounds; subscribed so it updates once per ingest
  // (zoom/scroll ticks don't touch projectStore → no re-render storm).
  const durationSec = useProjectStore((s) => s.audio?.durationSec ?? 0)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (canvas === null || wrap === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    let raf = 0
    let cssW = 0
    let disposed = false
    const resize = (): void => {
      cssW = Math.max(1, wrap.getBoundingClientRect().width)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    const draw = (): void => {
      raf = 0
      if (disposed || document.hidden) return
      const project = useProjectStore.getState().project
      const audio = useProjectStore.getState().audio
      const { pxPerSec, scrollX } = useZoomPan.getState()

      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(RULER_H * dpr)
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${RULER_H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      ctx.fillStyle = COLORS.header
      ctx.fillRect(0, 0, cssW, RULER_H)

      const bpm = project?.bpm ?? 120
      const beatDur = 60 / bpm
      const barDur = beatDur * 4
      const t0 = scrollX / pxPerSec
      const t1 = (scrollX + cssW) / pxPerSec

      ctx.font = '10px Inter, system-ui, sans-serif'
      // Second ticks. Labels are gated on density so far-zoom-out stays legible;
      // bar labels are skipped when a bar is narrower than the text.
      const showSecondLabels = pxPerSec >= 15
      for (let s = Math.floor(t0); s <= Math.ceil(t1); s++) {
        if (s < 0) continue
        const x = Math.round(secToX(s, pxPerSec) - scrollX) + 0.5
        ctx.strokeStyle = '#2a3a4a'
        ctx.beginPath()
        ctx.moveTo(x, RULER_H - 8)
        ctx.lineTo(x, RULER_H)
        ctx.stroke()
        const onBarLine = Math.abs(s / barDur - Math.round(s / barDur)) < 1e-6
        if (showSecondLabels && !onBarLine) {
          ctx.fillStyle = '#7d8fa1'
          ctx.fillText(`${s}`, x + 3, 11)
        }
      }
      // Bar numbers
      const showBarLabels = pxPerSec * barDur >= 30
      for (let b = Math.floor(t0 / barDur); b <= Math.ceil(t1 / barDur); b++) {
        if (b < 0) continue
        const x = Math.round(secToX(b * barDur, pxPerSec) - scrollX) + 0.5
        ctx.strokeStyle = COLORS.bar
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, RULER_H)
        ctx.stroke()
        if (showBarLabels) {
          ctx.fillStyle = '#e6eef5'
          const bar = b + 1
          ctx.fillText(`${bar}.1`, x + 3, 23)
        }
      }

      // Playhead triangle marker — same x-map as the canvas playhead line.
      if (audio !== null) {
        const px = secToX(getEngine().getPlayhead(), pxPerSec) - scrollX
        ctx.fillStyle = COLORS.accent
        ctx.beginPath()
        ctx.moveTo(px - 5, 0)
        ctx.lineTo(px + 5, 0)
        ctx.lineTo(px, 8)
        ctx.closePath()
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    // Idle saving: pause while the tab is hidden, resume when visible.
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
    }
  }, [])

  return (
    <div ref={wrapRef} className="w-full" style={{ height: RULER_H }} data-testid="ruler-wrap">
      <canvas
        ref={canvasRef}
        role="slider"
        aria-label="Seek: click to move playhead"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSec)}
        tabIndex={0}
        onClick={(e) => {
          seekFromClientX(e.clientX, e.target as Element)
        }}
        onKeyDown={(e) => {
          const engine = getEngine()
          if (e.key === 'ArrowLeft') {
            e.stopPropagation()
            e.preventDefault()
            engine.seek(engine.getPlayhead() - 1)
            useProjectStore.getState().setPlayhead(engine.getPlayhead())
          } else if (e.key === 'ArrowRight') {
            e.stopPropagation()
            e.preventDefault()
            engine.seek(engine.getPlayhead() + 1)
            useProjectStore.getState().setPlayhead(engine.getPlayhead())
          }
        }}
      />
    </div>
  )
}
