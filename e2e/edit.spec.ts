// M3 editor smoke: select → move → undo/redo → cut → delete (PRD M3.7).
import { expect, test, type Page } from '@playwright/test'

const TONE_WAV = '/tmp/test-tone.wav'

interface DebugChunk {
  id: string
  startSec: number
  endSec: number
  baseMidi: number
}

interface HarmonyDebug {
  project: {
    getState: () => {
      project: { voices: Array<{ chunks: DebugChunk[] }> } | null
    }
  }
  selection: {
    getState: () => { selectedIds: string[]; tool: string }
  }
  zoom: {
    getState: () => {
      pxPerSec: number
      pxPerNote: number
      scrollX: number
      scrollY: number
      setScroll: (x: number, y: number) => void
    }
  }
  undo: { canUndo: boolean; canRedo: boolean }
}

function debug(page: Page): Promise<{
  chunks: DebugChunk[]
  selected: string[]
  tool: string
  canUndo: boolean
  canRedo: boolean
}> {
  return page.evaluate(() => {
    const h = (window as unknown as { __harmony: HarmonyDebug }).__harmony
    const project = h.project.getState().project
    return {
      chunks: project?.voices.flatMap((v) => v.chunks) ?? [],
      selected: h.selection.getState().selectedIds,
      tool: h.selection.getState().tool,
      canUndo: h.undo.canUndo,
      canRedo: h.undo.canRedo,
    }
  })
}

/** Scroll so the chunk's midpoint is centered, then return page coords. */
async function chunkPagePoint(page: Page, chunk: DebugChunk): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('pitch-canvas-wrap').boundingBox()
  expect(box).not.toBeNull()
  const mid = (chunk.startSec + chunk.endSec) / 2
  await page.evaluate(
    ({ baseMidi, viewH }) => {
      const h = (window as unknown as { __harmony: HarmonyDebug }).__harmony
      const z = h.zoom.getState()
      // MIDI_C6=84: y = (84 - base) * pxPerNote.
      z.setScroll(0, (84 - baseMidi) * z.pxPerNote - viewH / 2)
    },
    { baseMidi: chunk.baseMidi, viewH: box?.height ?? 400 },
  )
  const view = await page.evaluate(() => {
    const h = (window as unknown as { __harmony: HarmonyDebug }).__harmony
    const z = h.zoom.getState()
    return { pxPerSec: z.pxPerSec, pxPerNote: z.pxPerNote, scrollX: z.scrollX, scrollY: z.scrollY }
  })
  const x = mid * view.pxPerSec - view.scrollX
  const y = (84 - chunk.baseMidi) * view.pxPerNote - view.scrollY + view.pxPerNote / 2
  return { x: (box?.x ?? 0) + x, y: (box?.y ?? 0) + y }
}

test('select → arrow move → undo/redo → cut → delete', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Choose audio file, MP3 or WAV').setInputFiles(TONE_WAV)
  await expect(page.getByTestId('file-status')).toContainText('test-tone.wav', { timeout: 15_000 })
  await expect(page.getByTestId('voice-tabs')).toContainText('Voice 1')

  // Toolbar appears with the project; tools default to select.
  await expect(page.getByTestId('edit-toolbar')).toBeVisible()
  expect((await debug(page)).tool).toBe('select')

  const before = await debug(page)
  expect(before.chunks.length).toBeGreaterThan(0)
  const chunk = before.chunks[0]
  if (chunk === undefined) throw new Error('no chunk to edit')
  const origBase = chunk.baseMidi
  const pt = await chunkPagePoint(page, chunk)

  // Click selects one chunk.
  await page.mouse.click(pt.x, pt.y)
  await expect(page.getByTestId('selection-count')).toContainText('1 selected')
  expect((await debug(page)).selected).toEqual([chunk.id])

  // Marquee around the chunk re-selects it (drag on empty clears first).
  await page.keyboard.press('Escape')
  expect((await debug(page)).selected).toEqual([])
  await page.mouse.move(pt.x - 30, pt.y - 20)
  await page.mouse.down()
  await page.mouse.move(pt.x + 30, pt.y + 20, { steps: 5 })
  await page.mouse.up()
  expect((await debug(page)).selected).toEqual([chunk.id])

  // Mouse drag moves rigidly: 32 px up at 16 px/note = +2 st (ghost commits).
  await page.mouse.move(pt.x, pt.y)
  await page.mouse.down()
  await page.mouse.move(pt.x, pt.y - 32, { steps: 5 })
  await page.mouse.up()
  let s = await debug(page)
  expect(s.chunks[0]?.baseMidi).toBe(origBase + 2)
  await page.keyboard.press('Control+Z')
  expect((await debug(page)).chunks[0]?.baseMidi).toBe(origBase)

  // ArrowUp moves +1 semitone (<50 ms visual feedback; state asserts the math).
  await page.keyboard.press('ArrowUp')
  s = await debug(page)
  expect(s.chunks[0]?.baseMidi).toBe(origBase + 1)
  expect(s.canUndo).toBe(true)
  await expect(page.getByRole('button', { name: /Undo \(Ctrl\+Z\)/ })).toBeEnabled()

  // Undo restores, redo re-applies (FR4.6).
  await page.keyboard.press('Control+Z')
  s = await debug(page)
  expect(s.chunks[0]?.baseMidi).toBe(origBase)
  expect(s.canRedo).toBe(true)
  await page.keyboard.press('Control+Shift+Z')
  expect((await debug(page)).chunks[0]?.baseMidi).toBe(origBase + 1)
  // Back to pristine for the cut assertions below.
  await page.keyboard.press('Control+Z')
  expect((await debug(page)).chunks[0]?.baseMidi).toBe(origBase)

  // Cut tool (C) + click splits the chunk; B is selected after (FR5.1).
  await page.keyboard.press('c')
  expect((await debug(page)).tool).toBe('cut')
  const n = (await debug(page)).chunks.length
  const cut = before.chunks[0]
  if (cut === undefined) throw new Error('no chunk to cut')
  const cutPt = await chunkPagePoint(page, cut)
  await page.mouse.click(cutPt.x, cutPt.y)
  s = await debug(page)
  expect(s.chunks.length).toBe(n + 1)
  expect(s.selected).toHaveLength(1)
  expect(s.selected[0]).not.toBe(cut.id)

  // Delete removes B; undo brings it back (FR5.2).
  await page.keyboard.press('v') // back to select so Delete is unambiguous
  await page.keyboard.press('Delete')
  expect((await debug(page)).chunks.length).toBe(n)
  await page.keyboard.press('Control+Z')
  s = await debug(page)
  expect(s.chunks.length).toBe(n + 1)

  // Autosave rides along: reload keeps the cut.
  await page.waitForTimeout(1500)
  await page.reload()
  await expect(page.getByTestId('file-status')).toContainText('test-tone.wav', { timeout: 15_000 })
  expect((await debug(page)).chunks.length).toBe(n + 1)
})
