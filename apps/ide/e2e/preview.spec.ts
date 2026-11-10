import { _electron as electron, expect, type ElectronApplication, type Page, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A 4×4 PNG in the accent blue.
const LOGO = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGOomfMfjhiI4wAAXZEhcW5p1gkAAAAASUVORK5CYII='

const GUIDE = [
  '# Guide',
  '',
  'Read the [site](https://example.com/x), the [notes](notes.md), the [setup](#setup) or [later](#later).',
  '',
  '| Name | Value |',
  '| --- | --- |',
  '| alpha | 1 |',
  '| beta | 2 |',
  '',
  '- [x] done',
  '- [ ] todo',
  '',
  '```ts',
  'const answer: number = 42',
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  Start-->Finish',
  '```',
  '',
  '![logo](img/logo.png)',
  '',
  // Enough text that the Setup heading starts out of view.
  ...Array.from({ length: 60 }, (_, i) => `Filler paragraph ${i + 1}.\n`),
  '<a name="later">Later on</a>, an old-style anchor.',
  '',
  ...Array.from({ length: 30 }, (_, i) => `More filler ${i + 1}.\n`),
  '## Setup',
  '',
  'The end.',
  ''
].join('\n')

const EVIL = [
  '# Evil',
  '',
  '<script>window.__pwned = 1</script>',
  '',
  '<img src="x" onerror="window.__pwned = 1">',
  '',
  '<a href="javascript:window.__pwned = 1">click me</a>',
  ''
].join('\n')

// A diagram far taller than its source, then an image, then enough text to scroll.
const TALL = [
  '# Tall',
  '',
  '```mermaid',
  'graph TD',
  '  A-->B-->C-->D-->E-->F-->G-->H',
  '```',
  '',
  '![logo](img/logo.png)',
  '',
  ...Array.from({ length: 20 }, (_, i) => `Line ${i + 1}.\n`)
].join('\n')

/** A project with the markdown fixtures, opened in a fresh app on the Code view. */
async function launch(): Promise<{ app: ElectronApplication; page: Page; project: string }> {
  const userData = mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-'))
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-project-')))
  mkdirSync(join(project, 'docs', 'img'), { recursive: true })
  writeFileSync(join(project, 'docs', 'guide.md'), GUIDE)
  writeFileSync(join(project, 'docs', 'notes.md'), '# Notes\n\nSome notes.\n')
  writeFileSync(join(project, 'docs', 'evil.md'), EVIL)
  writeFileSync(join(project, 'docs', 'tall.md'), TALL)
  writeFileSync(join(project, 'docs', 'broken.md'), '# Broken\n\n```mermaid\ngraph TD\n  A-->\n```\n')
  writeFileSync(join(project, 'docs', 'img', 'logo.png'), Buffer.from(LOGO, 'base64'))
  writeFileSync(join(project, 'a.ts'), 'export const a = 1\n')

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
  await expect(page.getByTestId('agent-tile')).toHaveCount(1)
  await page.getByRole('tab', { name: 'Code' }).click()
  await page.getByTestId('file-entry').filter({ hasText: 'docs' }).click()
  return { app, page, project }
}

/** Opens a file from the tree; `docs` is already expanded. */
const openFile = (page: Page, name: string) => page.getByTestId('file-entry').filter({ hasText: name }).first().click()

test('preview renders a markdown file and toggles back', async () => {
  const { app, page } = await launch()
  const toggle = page.getByTestId('markdown-preview-toggle')
  const preview = page.getByTestId('markdown-preview')
  const editor = page.locator('.cm-content')

  // Only markdown files can be previewed.
  await openFile(page, 'a.ts')
  await expect(editor).toContainText('export const a = 1')
  await expect(toggle).toHaveCount(0)

  await openFile(page, 'guide.md')
  await expect(editor).toContainText('# Guide')
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(preview.locator('h1')).toHaveText('Guide')
  await expect(preview.locator('table td').first()).toHaveText('alpha')
  await expect(preview.locator('table td')).toHaveCount(4)
  const boxes = preview.locator('input[type="checkbox"]')
  await expect(boxes).toHaveCount(2)
  for (const box of await boxes.all()) await expect(box).toBeDisabled()
  await expect(boxes.first()).toBeChecked()

  // Code is coloured like the editor: some span differs in colour from the plain code text.
  const code = preview.locator('pre code').first()
  await expect(code).toHaveClass(/highlighted/)
  await expect(code).toContainText('const answer: number = 42')
  const coloured = await code.evaluate((el) => {
    const plain = getComputedStyle(el).color
    return [...el.querySelectorAll('span')].some((s) => getComputedStyle(s).color !== plain)
  })
  expect(coloured).toBe(true)

  await expect(preview.locator('.mermaid svg')).toBeVisible({ timeout: 15_000 })
  await expect(preview.locator('.mermaid')).toContainText('Start')

  const logo = preview.locator('img[alt="logo"]')
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(4)

  await expect(page.getByTestId('code-editor')).toBeHidden()
  await page.screenshot({ path: 'test-results/preview.png' })

  await toggle.click()
  await expect(preview).toHaveCount(0)
  await expect(page.getByTestId('code-editor')).toBeVisible()
  await expect(editor.locator('.cm-line').first()).toHaveText('# Guide')
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0)
  await app.close()
})

test('⌘⇧V toggles the preview', async () => {
  const { app, page, project } = await launch()
  const preview = page.getByTestId('markdown-preview')
  const editor = page.locator('.cm-content')

  await openFile(page, 'guide.md')
  await editor.click()
  await page.keyboard.press('Meta+Shift+V')
  await expect(preview.locator('h1')).toHaveText('Guide')
  await page.keyboard.press('Meta+Shift+V')
  await expect(preview).toHaveCount(0)
  await expect(page.getByTestId('code-editor')).toBeVisible()

  // In any other file it does nothing: no preview, and the file is unchanged.
  await openFile(page, 'a.ts')
  await editor.click()
  await page.keyboard.press('Meta+Shift+V')
  await expect(preview).toHaveCount(0)
  await expect(editor).toHaveText('export const a = 1')
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0)
  expect(readFileSync(join(project, 'a.ts'), 'utf8')).toBe('export const a = 1\n')
  await app.close()
})

test('each tab remembers its preview', async () => {
  const { app, page } = await launch()
  const preview = page.getByTestId('markdown-preview')
  const editor = page.locator('.cm-content')
  const tabs = page.getByTestId('editor-tab')

  await openFile(page, 'guide.md')
  await openFile(page, 'notes.md')
  await tabs.filter({ hasText: 'guide.md' }).click()
  await page.getByTestId('markdown-preview-toggle').click()
  await expect(preview.locator('h1')).toHaveText('Guide')

  await tabs.filter({ hasText: 'notes.md' }).click()
  await expect(preview).toHaveCount(0)
  await expect(editor).toContainText('Some notes.')
  await expect(page.getByTestId('markdown-preview-toggle')).toHaveAttribute('aria-pressed', 'false')

  await tabs.filter({ hasText: 'guide.md' }).click()
  await expect(preview.locator('h1')).toHaveText('Guide')
  await expect(page.getByTestId('markdown-preview-toggle')).toHaveAttribute('aria-pressed', 'true')

  // Closing the tab forgets it.
  await page.getByRole('button', { name: 'Close guide.md' }).click()
  await openFile(page, 'guide.md')
  await expect(editor).toContainText('# Guide')
  await expect(preview).toHaveCount(0)
  await app.close()
})

test('the preview shows unsaved edits and follows agent edits', async () => {
  const { app, page, project } = await launch()
  const preview = page.getByTestId('markdown-preview')
  const toggle = page.getByTestId('markdown-preview-toggle')
  const editor = page.locator('.cm-content')

  await openFile(page, 'notes.md')
  await editor.click()
  await page.keyboard.press('Meta+ArrowUp')
  await page.keyboard.type('## Draft heading')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('dirty-dot')).toHaveCount(1)

  await toggle.click()
  await expect(preview.locator('h2')).toHaveText('Draft heading')
  // Typing while previewed never reaches the hidden source.
  await page.keyboard.type('xyz')
  await expect(page.getByTestId('dirty-dot')).toHaveCount(1)
  expect(readFileSync(join(project, 'docs', 'notes.md'), 'utf8')).toBe('# Notes\n\nSome notes.\n')

  // Back in the source, undo still takes the edit away.
  await toggle.click()
  await expect(editor).not.toContainText('xyz')
  for (let i = 0; i < 3 && (await editor.textContent())?.includes('Draft heading'); i++) await page.keyboard.press('Meta+z')
  await expect(editor).not.toContainText('Draft heading')
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0)

  // An agent changing the clean file shows up in the preview.
  await toggle.click()
  await expect(preview.locator('h1')).toHaveText('Notes')
  writeFileSync(join(project, 'docs', 'notes.md'), '# Agent heading\n')
  await expect(preview.locator('h1')).toHaveText('Agent heading')
  await app.close()
})

test('a conflict while previewing: compare, then reload into the preview', async () => {
  const { app, page, project } = await launch()
  const preview = page.getByTestId('markdown-preview')
  const banner = page.getByTestId('disk-conflict')
  const editor = page.locator('.cm-content')

  await openFile(page, 'notes.md')
  await editor.click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type('Mine.')
  await page.getByTestId('markdown-preview-toggle').click()
  await expect(preview).toContainText('Mine.')

  writeFileSync(join(project, 'docs', 'notes.md'), '# Theirs\n')
  await expect(banner).toBeVisible()
  await expect(preview).toContainText('Mine.')

  // The comparison takes the preview's place while it is open.
  await banner.getByRole('button', { name: 'Compare' }).click()
  await expect(page.getByTestId('conflict-diff')).toBeVisible()
  await expect(preview).toHaveCount(0)
  await banner.getByRole('button', { name: 'Hide comparison' }).click()
  await expect(preview).toContainText('Mine.')

  await banner.getByRole('button', { name: 'Reload' }).click()
  await expect(banner).toHaveCount(0)
  await expect(preview.locator('h1')).toHaveText('Theirs')
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0)
  // Focus didn't go back to the hidden source.
  await page.keyboard.type('xyz')
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0)
  await app.close()
})

test('an agent saving the file keeps the preview where it was', async () => {
  const { app, page, project } = await launch()
  const preview = page.getByTestId('markdown-preview')

  await openFile(page, 'tall.md')
  await page.getByTestId('markdown-preview-toggle').click()
  await expect(preview.locator('.mermaid svg')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => preview.locator('img[alt="logo"]').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(4)

  // Scrolled to the bottom: had the diagram fallen back to its source while re-rendering, the page
  // would get far shorter and the scroll position would be clamped.
  const before = await preview.evaluate((el) => {
    el.scrollTop = el.scrollHeight
    return el.scrollTop
  })
  expect(before).toBeGreaterThan(200)

  // Every painted frame from here on: was the diagram showing its source, or the image unloaded?
  await preview.evaluate((el) => {
    const w = window as any
    w.__flashes = []
    const check = () => {
      if (el.querySelector('pre code.language-mermaid')) w.__flashes.push('diagram source')
      if (el.querySelector('img:not([src])')) w.__flashes.push('unloaded image')
      w.__frame = requestAnimationFrame(check)
    }
    w.__frame = requestAnimationFrame(check)
  })
  writeFileSync(join(project, 'docs', 'tall.md'), TALL + '\nAppended by an agent.\n')
  await expect(preview).toContainText('Appended by an agent.')
  await page.waitForTimeout(300)
  const flashes = await page.evaluate(() => {
    cancelAnimationFrame((window as any).__frame)
    return [...new Set((window as any).__flashes as string[])]
  })
  expect(flashes).toEqual([])
  expect(await preview.evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(before)
  await app.close()
})

test('a search match in a previewed file shows its source', async () => {
  const { app, page } = await launch()
  const preview = page.getByTestId('markdown-preview')
  const toggle = page.getByTestId('markdown-preview-toggle')

  await openFile(page, 'guide.md')
  await toggle.click()
  await expect(preview.locator('h1')).toHaveText('Guide')

  await page.keyboard.press('Meta+Shift+f')
  await page.keyboard.type('More filler 7.')
  await page.getByTestId('search-match').first().click()
  await expect(preview).toHaveCount(0)
  await expect(page.getByTestId('code-editor')).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.cm-selectionMatch, .cm-content')).toContainText('More filler 7.')
  await app.close()
})

test('a broken mermaid diagram shows its source and the error', async () => {
  const { app, page } = await launch()
  const preview = page.getByTestId('markdown-preview')

  await openFile(page, 'broken.md')
  await page.getByTestId('markdown-preview-toggle').click()
  await expect(preview.locator('.mermaid-error')).toContainText('Mermaid:', { timeout: 15_000 })
  await expect(preview.locator('pre code.language-mermaid')).toContainText('A-->')
  // Nothing left behind outside the preview.
  await expect(page.locator('body > [id*="squadstorm-mermaid"]')).toHaveCount(0)
  await app.close()
})

test('links in the preview', async () => {
  const { app, page } = await launch()
  const preview = page.getByTestId('markdown-preview')

  await openFile(page, 'guide.md')
  await page.getByTestId('markdown-preview-toggle').click()

  // An old-style <a name> target works too.
  const later = preview.locator('[data-anchor="later"]')
  await expect(later).toHaveText('Later on')
  await expect(later).not.toBeInViewport()
  await preview.getByRole('link', { name: 'later', exact: true }).click()
  await expect(later).toBeInViewport()

  // #setup scrolls to the heading.
  const setup = preview.locator('[data-anchor="setup"]')
  await expect(setup).toHaveText('Setup')
  await preview.evaluate((el) => (el.scrollTop = 0))
  await expect(setup).not.toBeInViewport()
  await preview.getByRole('link', { name: 'setup', exact: true }).click()
  await expect(setup).toBeInViewport()

  // Web links go to the browser; the app stays put.
  await preview.getByRole('link', { name: 'site', exact: true }).click()
  await expect.poll(() => app.evaluate(() => (globalThis as any).__squadstormOpened)).toEqual(['https://example.com/x'])
  await expect(preview.locator('h1')).toHaveText('Guide')

  // A markdown file opens in its own tab, in preview.
  await preview.getByRole('link', { name: 'notes', exact: true }).click()
  await expect(page.getByTestId('editor-tab')).toHaveCount(2)
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'notes.md' })).toHaveAttribute('aria-selected', 'true')
  await expect(preview.locator('h1')).toHaveText('Notes')
  await app.close()
})

test('the preview runs nothing from the file', async () => {
  const { app, page } = await launch()
  const preview = page.getByTestId('markdown-preview')

  await openFile(page, 'evil.md')
  await page.getByTestId('markdown-preview-toggle').click()
  await expect(preview.locator('h1')).toHaveText('Evil')
  await preview.getByText('click me').click()

  await expect(preview.locator('script')).toHaveCount(0)
  await expect(preview.locator('[onerror]')).toHaveCount(0)
  // Give an image error handler time to fire, had it survived.
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined()
  expect(await app.evaluate(() => (globalThis as any).__squadstormOpened)).toBeUndefined()
  await app.close()
})
