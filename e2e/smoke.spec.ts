// M1 smoke: app boots to the empty piano-roll shell.
import { expect, test } from '@playwright/test'

test('boots with upload + piano-roll shell', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Harmony Gen/)
  await expect(page.getByTestId('dropzone')).toBeVisible()
  await expect(page.getByTestId('pitch-canvas-wrap')).toBeVisible()
  await expect(page.getByRole('button', { name: /Upload MP3/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Play/ })).toBeVisible()
})
