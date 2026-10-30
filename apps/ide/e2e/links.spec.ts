import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Stand-in for the agent CLIs: prints a path, a missing path and two URLs, then echoes its input
// (the terminal echoes what's typed or pasted; `cat` repeats a line once it's submitted).
const FAKE_AGENT = `
echo "see src/a.ts:3 and src/missing.ts:1"
echo "docs at https://example.com/x and file:///etc/passwd"
exec cat
`

interface Session {
  app: ElectronApplication
  page: Page
  project: string
}

async function launch(): Promise<Session> {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-links-')))
  mkdirSync(join(project, 'src'))
  writeFileSync(join(project, 'src', 'a.ts'), ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'].join('\n') + '\n')
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      SQUADSTORM_E2E: '1',
      SQUADSTORM_USER_DATA: mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-')),
      SQUADSTORM_AGENT_CMD: FAKE_AGENT
    }
  })
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, project)
  const page = await app.firstWindow()
  await page.getByTestId('count-codex').getByLabel('More').click()
  await page.getByTestId('pick-folder').click()
  await page.getByTestId('start').click()
  await expect(page.getByTestId('agent-tile')).toHaveCount(2)
  return { app, page, project }
}

async function output(app: ElectronApplication, tile: Locator): Promise<string> {
  const id = await tile.getAttribute('data-agent-id')
  return app.evaluate((_electron, agentId) => (globalThis as any).__squadstormPtys.backlogs()[agentId!] ?? '', id)
}

const count = (text: string, part: string) => text.split(part).length - 1

async function openFile(page: Page) {
  await page.getByRole('tab', { name: 'Code' }).click()
  await page.locator('[data-testid="file-entry"][title="src"]').click()
  await page.locator('[data-testid="file-entry"][title="src/a.ts"]').click()
  await expect(page.getByTestId('code-editor').locator('.cm-content')).toContainText('line 5')
}

test('send a selection to an agent', async () => {
  const { app, page } = await launch()
  const [claude, codex] = [page.getByTestId('agent-tile').nth(0), page.getByTestId('agent-tile').nth(1)]
  await openFile(page)

  // Lines 2–3 to Codex 1, with a note: inserted, not submitted.
  const editor = page.getByTestId('code-editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('Meta+ArrowUp')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Meta+l')
  const picker = page.getByTestId('send-picker')
  await expect(picker).toContainText('src/a.ts:2-3')
  await picker.getByTestId('send-target').filter({ hasText: 'Codex 1' }).click()
  await page.getByTestId('send-note').fill('use a Map')
  await page.keyboard.press('Enter')

  await expect(picker).toBeHidden()
  await expect(codex).toBeVisible()
  await expect(codex).toHaveAttribute('data-focused', 'true')
  await expect.poll(() => output(app, codex)).toContain('200~src/a.ts:2-3 use a Map')
  expect(count(await output(app, codex), 'src/a.ts:2-3 use a Map')).toBe(1)
  expect(await output(app, claude)).not.toContain('use a Map')

  // ⌘↵ also submits; with nothing selected the whole file goes, to the last focused agent.
  await page.keyboard.press('Meta+e')
  await editor.click()
  await page.keyboard.press('Meta+l')
  await expect(picker.getByRole('option', { selected: true })).toContainText('Codex 1')
  await page.getByTestId('send-note').fill('second')
  await page.keyboard.press('Meta+Enter')
  // Once echoed as typed, once by `cat` after the submit.
  await expect.poll(async () => count(await output(app, codex), 'src/a.ts second')).toBe(2)

  await app.close()
})

test('send a file from the tree', async () => {
  const { app, page } = await launch()
  const claude = page.getByTestId('agent-tile').nth(0)
  await page.getByRole('tab', { name: 'Code' }).click()
  await page.locator('[data-testid="file-entry"][title="src"]').click()
  const row = page.locator('[data-testid="file-entry"][title="src/a.ts"]')
  await row.hover()
  await row.getByTestId('send-file').click()
  await page.getByTestId('send-picker').getByTestId('send-target').filter({ hasText: 'Claude 1' }).click()
  await page.keyboard.press('Enter')
  await expect.poll(() => output(app, claude)).toContain('200~src/a.ts')
  await app.close()
})

test('click a path or a URL in agent output', async () => {
  const { app, page } = await launch()
  const claude = page.getByTestId('agent-tile').nth(0)
  const id = await claude.getAttribute('data-agent-id')
  await expect.poll(() => output(app, claude)).toContain('docs at')
  await expect.poll(() => page.evaluate((agent) => (window as any).__squadstormLinks[agent!].ready(), id)).toBe(true)

  // Only files that exist are links; only http(s) URLs are.
  const texts = (line: string) =>
    page.evaluate(([agent, text]) => (window as any).__squadstormLinks[agent].find(text).map((l: { text: string }) => l.text), [id!, line])
  expect(await texts('see src/a.ts:3')).toEqual(['src/a.ts:3'])
  expect(await texts('docs at')).toEqual(['https://example.com/x'])

  const activate = (line: string, meta: boolean) =>
    page.evaluate(
      ([agent, text, withMeta]) => {
        const [link] = (window as any).__squadstormLinks[agent].find(text)
        link.activate(new MouseEvent('click', { metaKey: withMeta as boolean }), link.text)
      },
      [id!, line, meta] as const
    )

  // A plain click selects text as usual; ⌘-click opens.
  await activate('see src/a.ts:3', false)
  await page.waitForTimeout(300)
  await expect(page.getByTestId('code-editor')).toBeHidden()
  await activate('see src/a.ts:3', true)
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'a.ts' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('code-editor').locator('.cm-activeLine')).toHaveText('line 3')

  await activate('docs at', true)
  expect(await app.evaluate(() => (globalThis as any).__squadstormOpened)).toEqual(['https://example.com/x'])

  await app.close()
})

test('drop a file on a tile', async () => {
  const { app, page, project } = await launch()
  const claude = page.getByTestId('agent-tile').nth(0)
  const shot = join(project, "it's a shot.png")
  writeFileSync(shot, 'png')

  // A real File (one with a path on disk) comes from a file input; then drop it on the tile.
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.id = 'e2e-file'
    document.body.append(input)
  })
  await page.locator('#e2e-file').setInputFiles(shot)
  await claude.evaluate((tile) => {
    const data = new DataTransfer()
    data.items.add((document.getElementById('e2e-file') as HTMLInputElement).files![0])
    tile.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }))
    tile.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
  })
  await expect.poll(() => output(app, claude)).toContain(`200~'${project}/it'\\''s a shot.png' `)

  await app.close()
})
