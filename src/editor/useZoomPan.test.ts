// Zoom-to-cursor math + wheel routing (user-feedback round).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clamp,
  routeWheel,
  useZoomPan,
  zoomFactorForDelta,
  type WheelActions,
} from './useZoomPan'
import {
  DEFAULT_PX_PER_NOTE,
  DEFAULT_PX_PER_SEC,
  MAX_PX_PER_NOTE,
  MAX_PX_PER_SEC,
  MIN_PX_PER_NOTE,
  MIN_PX_PER_SEC,
} from '../constants'

beforeEach(() => {
  useZoomPan.getState().reset()
})

function mockActions(): WheelActions & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    zoomHAt: (x: number, f: number) => {
      calls.push(`h:${x}:${f}`)
      useZoomPan.getState().zoomHAt(x, f)
    },
    zoomVAt: (y: number, f: number) => {
      calls.push(`v:${y}:${f}`)
      useZoomPan.getState().zoomVAt(y, f)
    },
    setScroll: (x: number, y: number) => {
      calls.push(`pan:${x}:${y}`)
      useZoomPan.getState().setScroll(x, y)
    },
  }
}

describe('clamp', () => {
  it('bounds values', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })
})

describe('zoomFactorForDelta', () => {
  it('zooms out on scroll down, in on scroll up', () => {
    expect(zoomFactorForDelta(100)).toBeLessThan(1)
    expect(zoomFactorForDelta(-100)).toBeGreaterThan(1)
  })
})

describe('zoomHAt', () => {
  it('keeps the time under the cursor stationary', () => {
    const st = useZoomPan.getState()
    st.setScroll(120, 0)
    const cursorX = 200
    const before = (cursorX + 120) / DEFAULT_PX_PER_SEC
    st.zoomHAt(cursorX, 2)
    const after = useZoomPan.getState()
    expect(after.pxPerSec).toBe(DEFAULT_PX_PER_SEC * 2)
    expect((cursorX + after.scrollX) / after.pxPerSec).toBeCloseTo(before, 10)
  })

  it('clamps to min/max scale', () => {
    const st = useZoomPan.getState()
    st.zoomHAt(0, 1000)
    expect(useZoomPan.getState().pxPerSec).toBe(MAX_PX_PER_SEC)
    st.zoomHAt(0, 1 / 1000)
    expect(useZoomPan.getState().pxPerSec).toBe(MIN_PX_PER_SEC)
  })

  it('never scrolls negative', () => {
    const st = useZoomPan.getState()
    st.zoomHAt(500, 0.1)
    expect(useZoomPan.getState().scrollX).toBeGreaterThanOrEqual(0)
  })
})

describe('zoomVAt', () => {
  it('keeps the content under the cursor stationary', () => {
    const st = useZoomPan.getState()
    st.setScroll(0, 64)
    const cursorY = 100
    const before = (cursorY + 64) / DEFAULT_PX_PER_NOTE
    st.zoomVAt(cursorY, 2)
    const after = useZoomPan.getState()
    expect(after.pxPerNote).toBe(DEFAULT_PX_PER_NOTE * 2)
    expect((cursorY + after.scrollY) / after.pxPerNote).toBeCloseTo(before, 10)
  })

  it('clamps to min/max scale', () => {
    const st = useZoomPan.getState()
    st.zoomVAt(0, 1000)
    expect(useZoomPan.getState().pxPerNote).toBe(MAX_PX_PER_NOTE)
    st.zoomVAt(0, 1 / 1000)
    expect(useZoomPan.getState().pxPerNote).toBe(MIN_PX_PER_NOTE)
  })
})

describe('routeWheel', () => {
  it('plain wheel = vertical zoom to cursor', () => {
    const actions = mockActions()
    const kind = routeWheel(
      { deltaX: 0, deltaY: -100, ctrlKey: false, metaKey: false, shiftKey: false },
      10,
      20,
      useZoomPan.getState(),
      actions,
    )
    expect(kind).toBe('zoom-v')
    expect(actions.calls[0]).toMatch(/^v:20:/)
    expect(useZoomPan.getState().pxPerNote).toBeGreaterThan(DEFAULT_PX_PER_NOTE)
  })

  it('ctrl/cmd+wheel = horizontal zoom to cursor', () => {
    for (const mod of [
      { ctrlKey: true, metaKey: false },
      { ctrlKey: false, metaKey: true },
    ]) {
      useZoomPan.getState().reset()
      const actions = mockActions()
      const kind = routeWheel(
        { deltaX: 0, deltaY: -100, ...mod, shiftKey: false },
        10,
        20,
        useZoomPan.getState(),
        actions,
      )
      expect(kind).toBe('zoom-h')
      expect(actions.calls[0]).toMatch(/^h:10:/)
      expect(useZoomPan.getState().pxPerSec).toBeGreaterThan(DEFAULT_PX_PER_SEC)
    }
  })

  it('shift+wheel = horizontal pan, no zoom', () => {
    const actions = mockActions()
    const before = useZoomPan.getState()
    const kind = routeWheel(
      { deltaX: 0, deltaY: 50, ctrlKey: false, metaKey: false, shiftKey: true },
      0,
      0,
      before,
      actions,
    )
    expect(kind).toBe('pan')
    expect(actions.calls[0]).toBe('pan:50:0')
    expect(useZoomPan.getState().pxPerSec).toBe(DEFAULT_PX_PER_SEC)
    expect(useZoomPan.getState().pxPerNote).toBe(DEFAULT_PX_PER_NOTE)
    expect(useZoomPan.getState().scrollX).toBe(50)
  })

  it('prefers deltaX for shift+wheel when present', () => {
    const actions = mockActions()
    routeWheel(
      { deltaX: 30, deltaY: 50, ctrlKey: false, metaKey: false, shiftKey: true },
      0,
      0,
      useZoomPan.getState(),
      actions,
    )
    expect(useZoomPan.getState().scrollX).toBe(30)
  })

  it('zoom callbacks are invoked (mock check)', () => {
    const spy = vi.fn()
    const actions: WheelActions = { zoomHAt: spy, zoomVAt: spy, setScroll: spy }
    routeWheel(
      { deltaX: 0, deltaY: 10, ctrlKey: true, metaKey: false, shiftKey: false },
      1,
      2,
      { scrollX: 0, scrollY: 0 },
      actions,
    )
    expect(spy).toHaveBeenCalledOnce()
  })

  it('reset restores 100% defaults', () => {
    const st = useZoomPan.getState()
    st.zoomH(1)
    st.zoomV(1)
    st.setScroll(50, 50)
    st.reset()
    const after = useZoomPan.getState()
    expect(after.pxPerSec).toBe(DEFAULT_PX_PER_SEC)
    expect(after.pxPerNote).toBe(DEFAULT_PX_PER_NOTE)
    expect(after.scrollX).toBe(0)
    expect(after.scrollY).toBe(0)
  })
})
