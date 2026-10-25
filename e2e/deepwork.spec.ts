import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const webviews = (app: ElectronApplication) =>
  app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .filter((wc) => wc.getType() === 'webview')
      .map((wc) => ({ url: wc.getURL(), ua: wc.getUserAgent() }))
  )

test('deep work: opens the player, keeps it alive behind workspaces, blocks other webviews', async () => {
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
  await expect(page.getByTestId('agent-tile')).toHaveCount(1)

  // The player only mounts once Deep Work is first opened.
  expect(await webviews(app)).toHaveLength(0)
  await page.getByTestId('deep-work-entry').click()
  const screen = page.getByTestId('deep-work')
  await expect(screen).toBeVisible()
  await expect.poll(async () => (await webviews(app))[0]?.url).toMatch(/^https:\/\/(music|consent)\.youtube\.com\//)
  const [player] = await webviews(app)
  expect(player.ua).not.toContain('Electron')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'test-results/deepwork.png' })

  // Back to the workspace: the screen hides but the player keeps running.
  await page.getByText('agent', { exact: false }).first().click()
  await expect(screen).toBeHidden()
  await expect(page.getByTestId('agent-tile')).toBeVisible()
  expect(await webviews(app)).toHaveLength(1)

  // Anything other than the player is refused.
  await page.evaluate(() => {
    const rogue = document.createElement('webview')
    rogue.setAttribute('src', 'https://example.com/')
    document.body.appendChild(rogue)
  })
  await page.waitForTimeout(500)
  expect(await webviews(app)).toHaveLength(1)

  await app.close()
})
