import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Streams live SomaFM radio, so this needs network access.
test('deep work: plays a SomaFM station, switches stations, stops', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'vibe-e2e-data-'))
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'vibe-e2e-project-')))
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, VIBE_E2E: '1', VIBE_USER_DATA: userData, VIBE_AGENT_CMD: 'exec cat' }
  })
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, project)
  const page = await app.firstWindow()
  await page.getByTestId('pick-folder').click()
  await page.getByTestId('start').click()

  const panel = page.getByTestId('deep-work')
  const toggle = page.getByTestId('deep-work-toggle')
  await expect(toggle).toHaveAttribute('aria-label', 'Play')

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-label', 'Stop')
  // Once the stream is up, the subtitle shows the track from SomaFM's now-playing API.
  await expect(panel).toContainText('–', { timeout: 15_000 })
  await expect(panel).not.toContainText("Couldn't reach SomaFM")
  await page.screenshot({ path: 'test-results/deepwork.png' })

  // Switching station keeps playing, on the new station.
  await panel.getByLabel('Station').selectOption('dronezone')
  await expect(toggle).toHaveAttribute('aria-label', 'Stop')
  await expect(panel).toContainText('–', { timeout: 15_000 })

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-label', 'Play')
  await expect(panel).toContainText('Atmospheric textures')

  await app.close()
})
