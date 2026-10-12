// View controls: help guide, labeled zoom, custom vertical scroll.
import { expect, test } from '@playwright/test'

test('help guide opens via button and ? key, closes via Esc', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Keyboard shortcuts/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Middle-drag')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('ruler and canvas share the exact x-map (playhead alignment)', async ({ page }) => {
  await page.goto('/')
  const ruler = await page.getByTestId('ruler-wrap').boundingBox()
  const canvas = await page.getByTestId('pitch-canvas-wrap').boundingBox()
  expect(ruler).not.toBeNull()
  expect(canvas).not.toBeNull()
  // Same left edge and same width → triangle marker and playhead line agree.
  expect(Math.abs((ruler?.x ?? 0) - (canvas?.x ?? 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((ruler?.width ?? 0) - (canvas?.width ?? 0))).toBeLessThanOrEqual(1)
})

test('middle-drag pans the full distance (drag state survives)', async ({ page }) => {
  await page.goto('/')
  const vslider = page.getByRole('slider', { name: 'Scroll vertically' })
  await vslider.focus()
  await page.keyboard.press('End')
  const max = Number(await vslider.getAttribute('aria-valuemax'))
  expect(max).toBeGreaterThan(200)

  const box = await page.getByTestId('pitch-canvas-wrap').boundingBox()
  expect(box).not.toBeNull()
  const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2
  const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2
  // Grab-style drag downward in small steps: every move event must apply,
  // not just the first (regression: effect teardown used to reset the drag).
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(cx, cy + 100, { steps: 10 })
  await page.mouse.up({ button: 'middle' })

  const now = Number(await vslider.getAttribute('aria-valuenow'))
  expect(max - now).toBeGreaterThanOrEqual(80)
})

test('key highlight toggle enables with a project and flips state', async ({ page }) => {
  await page.goto('/')
  const box = page.getByRole('checkbox', { name: 'Highlight key' })
  await expect(box).toBeDisabled()
  await page.getByLabel('Choose audio file, MP3 or WAV').setInputFiles('/tmp/test-tone.wav')
  await expect(page.getByTestId('file-status')).toContainText('test-tone.wav', { timeout: 10_000 })
  await expect(box).toBeEnabled()
  await expect(box).toBeChecked()
  await box.uncheck()
  await expect(box).not.toBeChecked()
  await box.check()
  await expect(box).toBeChecked()
})

test('waveform toggle hides the preview and persists across reload', async ({ page }) => {
  await page.goto('/')
  const box = page.getByRole('checkbox', { name: 'Show waveform' })
  await expect(box).toBeDisabled()
  await page.getByLabel('Choose audio file, MP3 or WAV').setInputFiles('/tmp/test-tone.wav')
  await expect(page.getByTestId('file-status')).toContainText('test-tone.wav', { timeout: 10_000 })
  await expect(box).toBeEnabled()
  await expect(box).toBeChecked()
  await box.uncheck()
  await expect(box).not.toBeChecked()
  // Autosave debounce is 1 s — wait, then reload must keep it off.
  await page.waitForTimeout(1500)
  await page.reload()
  await expect(page.getByTestId('file-status')).toContainText('test-tone.wav', { timeout: 10_000 })
  await expect(page.getByRole('checkbox', { name: 'Show waveform' })).not.toBeChecked()
})

test('labeled H/V zoom groups + 100% reset + vertical slider', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('group', { name: 'Horizontal zoom' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Vertical zoom' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Reset zoom to 100/ })).toBeVisible()

  const vslider = page.getByRole('slider', { name: 'Scroll vertically' })
  await expect(vslider).toBeVisible()
  // End key scrolls to max; Home back to 0 (deterministic custom slider).
  await vslider.focus()
  await page.keyboard.press('End')
  const max = await vslider.getAttribute('aria-valuemax')
  expect(await vslider.getAttribute('aria-valuenow')).toBe(max)
  await page.keyboard.press('Home')
  expect(await vslider.getAttribute('aria-valuenow')).toBe('0')
})
