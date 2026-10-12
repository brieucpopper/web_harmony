// Minimap overview (PRD §4): mini waveform + viewport rect (M3), click to jump.
import { useEffect, useRef } from 'react'
import { useProjectStore } from '../store/projectStore'
import { useZoomPan } from './useZoomPan'

const MINI_H = 40 as const

/** Main canvas css width for the viewport-rect time mapping. */
function mainViewWidthPx(fallback: number): number {
  const el = document.querySelector('[data-testid="pitch-canvas-wrap"]')
  if (el === null) return fallback
  const w = el.getBoundingClientRect().width
  return w > 0 ? w : fallback
}

export default function Minimap(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audio = useProjectStore((s) => s.audio)
  // Viewport rect tracks pan/zoom: re-render + redraw on ticks (tiny canvas).
  const pxPerSec = useZoomPan((s) => s.pxPerSec)
  const scrollX = useZoomPan((s) => s.scrollX)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, rect.width)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(MINI_H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#111A23'
    ctx.fillRect(0, 0, w, MINI_H)
    const mono = audio?.mono
    if (mono !== undefined && audio !== null && mono.length > 0) {
      ctx.strokeStyle = '#4a6076'
      ctx.beginPath()
      const n = Math.max(1, Math.floor(w))
      for (let px = 0; px < n; px++) {
        const idx = Math.floor((px / n) * mono.length)
        const v = mono[idx] ?? 0
        const mid = MINI_H / 2
        ctx.moveTo(px + 0.5, mid - Math.abs(v) * (mid - 2))
        ctx.lineTo(px + 0.5, mid + Math.abs(v) * (mid - 2))
      }
      ctx.stroke()
      // Viewport rect: the time range the main canvas shows, as a fraction
      // of total content width (duration × pxPerSec).
      const totalW = audio.durationSec * pxPerSec
      if (totalW > 0) {
        const rx = Math.min(w - 2, Math.max(0, (scrollX / totalW) * w))
        const rw = Math.max(2, Math.min(w - rx, (mainViewWidthPx(w) / totalW) * w))
        ctx.fillStyle = 'rgba(232,154,46,0.12)'
        ctx.fillRect(rx, 1, rw, MINI_H - 2)
        ctx.strokeStyle = '#E89A2E'
        ctx.lineWidth = 1
        ctx.strokeRect(rx + 0.5, 1.5, rw - 1, MINI_H - 3)
      }
    } else {
      ctx.fillStyle = '#334455'
      ctx.font = '10px Inter, system-ui, sans-serif'
      ctx.fillText('minimap', 8, MINI_H / 2 + 3)
    }
  }, [audio, pxPerSec, scrollX])

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full cursor-pointer"
      style={{ height: MINI_H }}
      aria-label="Overview minimap: click to jump"
      onClick={(e) => {
        if (audio === null) return
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
        const frac = (e.clientX - rect.left) / Math.max(1, rect.width)
        const { pxPerSec: pps, scrollY, setScroll } = useZoomPan.getState()
        const viewW = rect.width
        const target = frac * audio.durationSec * pps - viewW / 2
        setScroll(Math.max(0, target), scrollY)
      }}
    />
  )
}
