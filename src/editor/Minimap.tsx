// Minimap overview (PRD §4): mini waveform, click to jump. Viewport rect in M3.
import { useEffect, useRef } from 'react'
import { useProjectStore } from '../store/projectStore'
import { useZoomPan } from './useZoomPan'

const MINI_H = 40 as const

export default function Minimap(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audio = useProjectStore((s) => s.audio)

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
    } else {
      ctx.fillStyle = '#334455'
      ctx.font = '10px Inter, system-ui, sans-serif'
      ctx.fillText('minimap', 8, MINI_H / 2 + 3)
    }
  }, [audio])

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
        const { pxPerSec, scrollY, setScroll } = useZoomPan.getState()
        const viewW = rect.width
        const target = frac * audio.durationSec * pxPerSec - viewW / 2
        setScroll(Math.max(0, target), scrollY)
      }}
    />
  )
}
