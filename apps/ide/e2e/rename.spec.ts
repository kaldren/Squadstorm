import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const project = () => realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-project-')))

function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      SQUADSTORM_E2E: '1',
      SQUADSTORM_USER_DATA: userData,
      // Stand-in for claude/codex (and the Terminal's shell): prints its cwd, then echoes input.
      SQUADSTORM_AGENT_CMD: 'echo "fake agent in $(pwd)"; exec cat'
    }
  })
}

/** Launches with a fresh profile and starts a workspace in `folder` with the given agents. */
async function start(folder: string, { codex = 0 } = {}): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const userData = mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-'))
  const app = await launch(userData)
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, folder)
  const page = await app.firstWindow()
  for (let i = 0; i < codex; i++) await page.getByTestId('count-codex').getByLabel('More').click()
  await page.getByTestId('pick-folder').click()
  await page.getByTestId('start').click()
  return { app, page, userData }
}

async function output(app: ElectronApplication, tile: Locator): Promise<string> {
  const id = await tile.getAttribute('data-agent-id')
  return app.evaluate((_electron, agentId) => (globalThis as any).__squadstormPtys.backlogs()[agentId!] ?? '', id)
}

async function rename(tile: Locator, text: string) {
  await tile.getByTestId('agent-name').dblclick()
  await tile.getByTestId('agent-name-input').fill(text)
  await tile.getByTestId('agent-name-input').press('Enter')
}

test('rename a tile, and the name survives a relaunch', async () => {
  const folder = project()
  let { app, page, userData } = await start(folder, { codex: 1 })
  await page.getByRole('button', { name: '+ Terminal' }).click()
  const tiles = page.getByTestId('agent-tile')
  await expect(tiles).toHaveCount(3)
  const claude = tiles.nth(0)
  await expect.poll(() => output(app, claude)).toContain(`fake agent in ${folder}`)
  const id = await claude.getAttribute('data-agent-id')

  // Double-clicking the name opens a field holding it, all selected: typing replaces it.
  await claude.getByTestId('agent-name').dblclick()
  const input = claude.getByTestId('agent-name-input')
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('Claude 1')
  await page.keyboard.type('Google OAuth')
  await page.keyboard.press('Enter')
  await expect(claude.getByTestId('agent-name')).toHaveText('Google OAuth')
  await expect(input).toBeHidden()

  // Same agent, same process: its earlier output is still there and it still takes input.
  expect(await claude.getAttribute('data-agent-id')).toBe(id)
  await claude.click()
  await page.keyboard.type('still here\r')
  await expect.poll(() => output(app, claude)).toContain('still here')
  expect((await output(app, claude)).match(/fake agent in/g)).toHaveLength(1)

  await rename(tiles.nth(1), 'Billing')
  await rename(tiles.nth(2), 'Logs')
  await expect(tiles.nth(1).getByTestId('agent-name')).toHaveText('Billing')
  await expect(tiles.nth(2).getByTestId('agent-name')).toHaveText('Logs')
  await app.close()

  app = await launch(userData)
  page = await app.firstWindow()
  const restored = page.getByTestId('agent-tile').getByTestId('agent-name')
  await expect(restored).toHaveText(['Google OAuth', 'Billing', 'Logs'])
  await app.close()
})

test('escape cancels, an empty name restores the automatic one', async () => {
  const { app, page } = await start(project())
  const tile = page.getByTestId('agent-tile')
  const name = tile.getByTestId('agent-name')
  const input = tile.getByTestId('agent-name-input')
  await rename(tile, 'Temp')
  await expect(name).toHaveText('Temp')
  // The tile's buttons follow the name.
  await expect(page.getByLabel('Maximize Temp')).toBeVisible()

  await name.dblclick()
  await input.fill('Other')
  await input.press('Escape')
  await expect(name).toHaveText('Temp')

  // Clicking away saves what was typed.
  await name.dblclick()
  await input.fill('Clicked away')
  await page.getByTestId('agent-terminal').click()
  await expect(name).toHaveText('Clicked away')

  // At most 40 characters.
  await name.dblclick()
  await input.fill('')
  await input.pressSequentially('x'.repeat(45))
  await expect(input).toHaveValue('x'.repeat(40))
  await input.press('Escape')

  await rename(tile, '')
  await expect(name).toHaveText('Claude 1')
  await expect(page.getByLabel('Maximize Claude 1')).toBeVisible()

  // Double-clicking the header anywhere but the name still maximizes the tile.
  await rename(tile, 'Google OAuth')
  await expect(page.getByLabel('Maximize Google OAuth')).toBeEnabled()
  await tile.getByTestId('agent-drag-handle').dblclick({ position: { x: 4, y: 4 } })
  await expect(page.getByLabel('Maximize Google OAuth')).toBeDisabled()
  await expect(input).toBeHidden()
  await app.close()
})

test('the send picker lists the new name', async () => {
  const folder = project()
  writeFileSync(join(folder, 'a.txt'), 'hello\n')
  const { app, page } = await start(folder)
  const tile = page.getByTestId('agent-tile')
  await rename(tile, 'Google OAuth')

  await page.getByRole('tab', { name: 'Code' }).click()
  const row = page.locator('[data-testid="file-entry"][title="a.txt"]')
  await row.hover()
  await row.getByTestId('send-file').click()
  await page.getByTestId('send-picker').getByTestId('send-target').filter({ hasText: 'Google OAuth' }).click()
  await page.keyboard.press('Enter')
  await expect.poll(() => output(app, tile)).toContain('a.txt')
  await app.close()
})
