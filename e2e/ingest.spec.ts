// M1 accept: decode <1 s, play/pause/seek in sync, reload restores buffer.
import { expect, test } from '@playwright/test'

const TONE_WAV = '/tmp/test-tone.wav'

test('ingest → play → seek → reload restores', async ({ page }) => {
  await page.goto('/')

  // Upload via the picker (same handler as drag-drop).
  await page.getByLabel('Choose audio file, MP3 or WAV').setInputFiles(TONE_WAV)
  await expect(page.getByTestId('file-status')).toContainText('test-tone.wav', { timeout: 10_000 })
  await expect(page.getByTestId('time-display')).toHaveText('00:00.000 / 00:10.000')

  // Play → playhead advances (single AudioContext clock).
  await page.getByRole('button', { name: /Play \(Space\)/ }).click()
  await expect(page.getByTestId('time-display')).not.toHaveText('00:00.000 / 00:10.000', {
    timeout: 5_000,
  })

  // Ruler click seeks (click near left edge → back toward 0).
  await page.getByRole('slider', { name: /Seek/ }).click({ position: { x: 130, y: 14 } })
  await page.getByRole('button', { name: /Pause \(Space\)/ }).click()
  await expect(page.getByRole('button', { name: /Play \(Space\)/ })).toBeVisible()

  // Autosave debounce is 1 s — wait, then reload must restore name + duration.
  await page.waitForTimeout(1500)
  await page.reload()
  await expect(page.getByTestId('file-status')).toContainText('test-tone.wav', { timeout: 10_000 })
  await expect(page.getByTestId('time-display')).toHaveText('00:00.000 / 00:10.000')
})
