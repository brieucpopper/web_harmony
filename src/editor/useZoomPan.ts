// Zoom/pan viewport state (PRD FR3.2).
// Gestures (amended per user feedback): wheel = V-zoom to cursor,
// Ctrl/Cmd+wheel = H-zoom to cursor, Shift+wheel = horizontal pan,
// middle-drag = free pan. Browser page-zoom stays locked at 100%:
// the canvas consumes these events with preventDefault (see PitchCanvas).
import { create } from 'zustand'
import {
  DEFAULT_PX_PER_NOTE,
  DEFAULT_PX_PER_SEC,
  MAX_PX_PER_NOTE,
  MAX_PX_PER_SEC,
  MIN_PX_PER_NOTE,
  MIN_PX_PER_SEC,
} from '../constants'

interface ZoomPanState {
  pxPerSec: number
  pxPerNote: number
  scrollX: number
  scrollY: number
  setPxPerSec: (v: number) => void
  setPxPerNote: (v: number) => void
  zoomH: (dir: 1 | -1) => void
  zoomV: (dir: 1 | -1) => void
  /** Zoom keeping the content under cursorX (css px in viewport) stationary. */
  zoomHAt: (cursorX: number, factor: number) => void
  /** Zoom keeping the content under cursorY (css px in viewport) stationary. */
  zoomVAt: (cursorY: number, factor: number) => void
  setScroll: (x: number, y: number) => void
  reset: () => void
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v))

/** Wheel step: one notch multiplies scale by this. */
export const WHEEL_ZOOM_STEP = 1.15 as const

export function zoomFactorForDelta(deltaY: number): number {
  return deltaY > 0 ? 1 / WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP
}

export const useZoomPan = create<ZoomPanState>()((set) => ({
  pxPerSec: DEFAULT_PX_PER_SEC,
  pxPerNote: DEFAULT_PX_PER_NOTE,
  scrollX: 0,
  scrollY: 0,
  setPxPerSec: (v) => { set({ pxPerSec: clamp(v, MIN_PX_PER_SEC, MAX_PX_PER_SEC) }); },
  setPxPerNote: (v) => { set({ pxPerNote: clamp(v, MIN_PX_PER_NOTE, MAX_PX_PER_NOTE) }); },
  zoomH: (dir) => { set((s) => ({
      pxPerSec: clamp(
        dir === 1 ? s.pxPerSec * 1.25 : s.pxPerSec / 1.25,
        MIN_PX_PER_SEC,
        MAX_PX_PER_SEC,
      ),
    })); },
  zoomV: (dir) => { set((s) => ({
      pxPerNote: clamp(
        dir === 1 ? s.pxPerNote * 1.25 : s.pxPerNote / 1.25,
        MIN_PX_PER_NOTE,
        MAX_PX_PER_NOTE,
      ),
    })); },
  zoomHAt: (cursorX, factor) => { set((s) => {
      const next = clamp(s.pxPerSec * factor, MIN_PX_PER_SEC, MAX_PX_PER_SEC)
      const timeAtCursor = (cursorX + s.scrollX) / s.pxPerSec
      return { pxPerSec: next, scrollX: Math.max(0, timeAtCursor * next - cursorX) }
    }); },
  zoomVAt: (cursorY, factor) => { set((s) => {
      const next = clamp(s.pxPerNote * factor, MIN_PX_PER_NOTE, MAX_PX_PER_NOTE)
      const contentY = cursorY + s.scrollY
      return { pxPerNote: next, scrollY: Math.max(0, (contentY * next) / s.pxPerNote - cursorY) }
    }); },
  setScroll: (x, y) => { set({ scrollX: Math.max(0, x), scrollY: Math.max(0, y) }); },
  reset: () => { set({
      pxPerSec: DEFAULT_PX_PER_SEC,
      pxPerNote: DEFAULT_PX_PER_NOTE,
      scrollX: 0,
      scrollY: 0,
    }); },
}))

export interface WheelEventLike {
  deltaX: number
  deltaY: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export interface WheelActions {
  zoomHAt: (x: number, f: number) => void
  zoomVAt: (y: number, f: number) => void
  setScroll: (x: number, y: number) => void
}

/**
 * Wheel routing, pure + unit-tested:
 * Ctrl/Cmd+wheel = H-zoom to cursor, Shift+wheel = horizontal pan,
 * plain wheel = V-zoom to cursor. Alt+wheel keeps the legacy PRD V-zoom.
 * Returns 'zoom-h' | 'zoom-v' | 'pan' for cursor styling if ever needed.
 */
export function routeWheel(
  e: WheelEventLike,
  cursorX: number,
  cursorY: number,
  s: { scrollX: number; scrollY: number },
  actions: WheelActions,
): 'zoom-h' | 'zoom-v' | 'pan' {
  if (e.ctrlKey || e.metaKey) {
    actions.zoomHAt(cursorX, zoomFactorForDelta(e.deltaY))
    return 'zoom-h'
  }
  if (e.shiftKey) {
    const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY
    actions.setScroll(s.scrollX + dx, s.scrollY)
    return 'pan'
  }
  // Plain wheel + legacy Alt+wheel: vertical zoom to cursor.
  actions.zoomVAt(cursorY, zoomFactorForDelta(e.deltaY))
  return 'zoom-v'
}
