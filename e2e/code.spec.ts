import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('code view: browse, edit, save, follow agent edits, switch back', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-'))
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-project-')))
  mkdirSync(join(project, 'src'))
  writeFileSync(join(project, 'src', 'index.ts'), 'export const answer = 1\n')
  writeFileSync(join(project, 'README.md'), '# hello\n')

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SQUADSTORM_E2E: '1', SQUADSTORM_USER_DATA: userData, SQUADSTORM_AGENT_CMD: 'exec cat' }
  })
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, project)
  const page = await app.firstWindow()
  await page.getByTestId('pick-folder').click()
  await page.getByTestId('start').click()
  const tiles = page.getByTestId('agent-tile')
  await expect(tiles).toHaveCount(1)

  await page.getByRole('tab', { name: 'Code' }).click()
  await expect(tiles.first()).toBeHidden()
  const entries = page.getByTestId('file-entry')
  await expect(entries).toHaveText([/src$/, 'README.md'])

  await entries.filter({ hasText: 'src' }).click()
  await page.getByTestId('file-entry').filter({ hasText: 'index.ts' }).click()
  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('export const answer = 1')

  // Edit and save with ⌘S.
  await editor.click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type('export const more = 2')
  await expect(page.getByTestId('dirty-dot')).toHaveCount(1)
  await page.keyboard.press('Meta+s')
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0)
  await expect.poll(() => readFileSync(join(project, 'src', 'index.ts'), 'utf8')).toContain('export const more = 2')

  // An agent writing the file and adding another shows up without a refresh.
  writeFileSync(join(project, 'src', 'index.ts'), 'export const changed = true\n')
  writeFileSync(join(project, 'src', 'new.ts'), '')
  await expect(editor).toContainText('export const changed = true')
  await expect(page.getByTestId('file-entry').filter({ hasText: 'new.ts' })).toHaveCount(1)
  await page.screenshot({ path: 'test-results/code.png' })

  // ⌘E flips back to the agents, which kept running.
  await page.keyboard.press('Meta+e')
  await expect(tiles.first()).toBeVisible()
  await expect(page.getByTestId('code-editor')).toBeHidden()
  await page.getByRole('tab', { name: 'Code' }).click()
  await expect(editor).toContainText('export const changed = true')
  await expect(page.getByTestId('editor-tab')).toHaveCount(1)

  await app.close()
})
