import { _electron as electron, expect, type Locator, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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

test("code view: a save never overwrites an agent's change", async () => {
  const userData = mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-'))
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-project-')))
  const file = join(project, 'index.ts')
  writeFileSync(file, 'export const answer = 1\n')
  const disk = () => (existsSync(file) ? readFileSync(file, 'utf8') : '')

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
  await page.getByRole('tab', { name: 'Code' }).click()
  await page.getByTestId('file-entry').filter({ hasText: 'index.ts' }).click()
  const editor = page.getByTestId('code-editor').locator('.cm-content')
  await expect(editor).toContainText('export const answer = 1')
  const banner = page.getByTestId('disk-conflict')
  const typeAtEnd = async (text: string) => {
    await editor.click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type(text)
    await expect(page.getByTestId('dirty-dot').or(page.getByTestId('conflict-dot'))).toHaveCount(1)
  }

  // The repro: unsaved edits, an agent appends a line, ⌘S. The agent's line must survive.
  await typeAtEnd('// mine')
  appendFileSync(file, 'agent line\n')
  await page.keyboard.press('Meta+s')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('changed on disk')
  await page.waitForTimeout(500)
  expect(disk()).toContain('agent line')
  expect(disk()).not.toContain('// mine')
  await expect(page.getByTestId('conflict-dot')).toHaveCount(1)

  // Compare shows both versions.
  await banner.getByRole('button', { name: 'Compare' }).click()
  const diff = page.getByTestId('conflict-diff')
  await expect(diff).toContainText('agent line')
  await expect(diff).toContainText('// mine')

  // Reload takes the disk version and the file is clean again, with the editor still focused.
  await banner.getByRole('button', { name: 'Reload' }).click()
  await expect(banner).toBeHidden()
  await expect(diff).toBeHidden()
  await expect(editor).toContainText('agent line')
  await expect(editor).not.toContainText('// mine')
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0)
  await expect(page.getByTestId('conflict-dot')).toHaveCount(0)
  await page.keyboard.type('// typed after reload')
  await expect(editor).toContainText('// typed after reload')
  await page.keyboard.press('Meta+s')
  await expect.poll(disk).toContain('// typed after reload')

  // An agent that puts the file back the way it was takes the conflict with it.
  const before = disk()
  await typeAtEnd('// mine too')
  appendFileSync(file, 'passing agent line\n')
  await expect(banner).toBeVisible()
  writeFileSync(file, before)
  await expect(banner).toBeHidden()
  await expect(page.getByTestId('dirty-dot')).toHaveCount(1)
  await page.keyboard.press('Meta+s')
  await expect.poll(disk).toContain('// mine too')

  // Keep mine: the banner goes, the file stays dirty, and the next save writes my version on purpose.
  await typeAtEnd('// mine again')
  appendFileSync(file, 'second agent line\n')
  await expect(banner).toBeVisible()
  await banner.getByRole('button', { name: 'Keep mine' }).click()
  await expect(banner).toBeHidden()
  await expect(page.getByTestId('dirty-dot')).toHaveCount(1)
  await editor.click()
  await page.keyboard.press('Meta+s')
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0)
  await expect.poll(disk).toContain('// mine again')
  expect(disk()).not.toContain('second agent line')

  // Deleted on disk while dirty: no Reload, and keeping mine recreates the file.
  await typeAtEnd('// before delete')
  rmSync(file)
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('deleted on disk')
  await expect(banner.getByRole('button', { name: 'Reload' })).toHaveCount(0)
  await banner.getByRole('button', { name: 'Keep mine' }).click()
  await editor.click()
  await page.keyboard.press('Meta+s')
  await expect.poll(disk).toContain('// before delete')
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0)

  await app.close()
})

test('code view: ⌘P finds and opens files', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-'))
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-project-')))
  mkdirSync(join(project, 'src', 'components'), { recursive: true })
  mkdirSync(join(project, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(project, 'src', 'components', 'CodeView.tsx'), 'export const view = 1\n')
  writeFileSync(join(project, 'src', 'index.ts'), '')
  writeFileSync(join(project, 'node_modules', 'pkg', 'view.js'), '')

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
  await page.getByRole('tab', { name: 'Code' }).click()
  await expect(page.getByTestId('file-entry')).toHaveCount(2)

  // Not a git repo: every file is searched except node_modules.
  const input = page.getByTestId('quick-open-input')
  const results = page.getByTestId('quick-open-result')
  await page.keyboard.press('Meta+p')
  await input.fill('view')
  await expect(results).toHaveText([/^CodeView\.tsx/])
  await page.screenshot({ path: 'test-results/quick-open.png' })
  await page.keyboard.press('Enter')
  await expect(input).toBeHidden()
  await expect(page.getByTestId('editor-tab')).toHaveText([/^CodeView\.tsx/])
  await expect(page.locator('.cm-content')).toContainText('export const view = 1')

  // Escape closes without opening anything; files added since are found next time.
  writeFileSync(join(project, 'src', 'later.ts'), '')
  await page.getByTestId('quick-open').click()
  await input.fill('later')
  await expect(results).toHaveText([/^later\.ts/])
  await page.keyboard.press('Escape')
  await expect(input).toBeHidden()
  await expect(page.getByTestId('editor-tab')).toHaveCount(1)

  // In a git repo, ignored files are left out.
  execFileSync('git', ['init', '-q'], { cwd: project })
  writeFileSync(join(project, '.gitignore'), 'dist/\n')
  mkdirSync(join(project, 'dist'))
  writeFileSync(join(project, 'dist', 'index.js'), '')
  await page.keyboard.press('Meta+p')
  await input.fill('index')
  await expect(results).toHaveText([/^index\.ts/])
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('editor-tab')).toHaveText([/^CodeView\.tsx/, /^index\.ts/])

  await app.close()
})

test('code view: ⌘⇧F searches file contents and jumps to matches', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-'))
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-project-')))
  mkdirSync(join(project, 'src'))
  writeFileSync(join(project, 'src', 'a.ts'), 'export const answer = 42\n// Answer: forty-two\nconst answers = [answer]\n')
  writeFileSync(join(project, 'README.md'), '# The answer\n')

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
  await page.getByRole('tab', { name: 'Code' }).click()
  await expect(page.getByTestId('file-entry')).toHaveCount(2)

  const input = page.getByTestId('search-input')
  const summary = page.getByTestId('search-summary')
  const matches = page.getByTestId('search-match')
  await page.keyboard.press('Meta+Shift+f')
  await expect(input).toBeFocused()
  await page.keyboard.type('answer')
  await expect(summary).toHaveText(/^5 results in 2 files/)
  await expect(page.getByTestId('search-file')).toHaveText([/^▾README\.md1/, /^▾a\.tssrc4/])

  // Toggles narrow the results: case, then whole word, then a regex.
  await page.getByRole('button', { name: 'Match Case' }).click()
  await expect(summary).toHaveText(/^4 results in 2 files/)
  await page.keyboard.press('Alt+KeyW')
  await expect(summary).toHaveText(/^3 results in 2 files/)
  await expect(page.getByRole('button', { name: 'Match Whole Word' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Use Regular Expression' }).click()
  await input.fill('\\w+s')
  await expect(summary).toHaveText(/^1 result in 1 file/)
  await input.fill('answer(')
  await expect(summary).toHaveText(/Invalid regex/)

  // Include / exclude globs.
  await page.getByRole('button', { name: 'Match Whole Word' }).click()
  await page.getByRole('button', { name: 'Use Regular Expression' }).click()
  await input.fill('answer')
  await expect(summary).toHaveText(/^4 results in 2 files/)
  await page.getByRole('button', { name: 'Toggle Search Details' }).click()
  await page.getByTestId('search-exclude').fill('*.md')
  await expect(summary).toHaveText(/^3 results in 1 file/)
  await page.screenshot({ path: 'test-results/search.png' })

  // Clicking a match opens the file with the match selected.
  await matches.nth(2).click()
  await expect(page.getByTestId('editor-tab')).toHaveText([/^a\.ts/])
  await expect(page.locator('.cm-activeLine')).toHaveText('const answers = [answer]')
  // The selection is drawn, not native; CodeMirror marks the other occurrences of it, though.
  await expect(page.locator('.cm-editor')).toHaveClass(/cm-focused/)
  await expect(page.locator('.cm-selectionBackground')).toHaveCount(1)
  await expect(page.locator('.cm-activeLine .cm-selectionMatch')).toHaveText('answer')
  await expect(matches.nth(2)).toHaveAttribute('aria-selected', 'true')

  // Files agents write show up in the results without searching again.
  writeFileSync(join(project, 'src', 'b.ts'), 'answer\n')
  await expect(summary).toHaveText(/^4 results in 2 files/)

  await app.close()
})

const openCode = async (project: string) => {
  const userData = mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-'))
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
  return { app, page }
}

test('code view: long lines wrap to the editor width', async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-project-')))
  const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
  const content = `first\n${long}\nlast\n`
  writeFileSync(join(project, 'notes.txt'), content)
  const { app, page } = await openCode(project)

  await page.getByTestId('file-entry').filter({ hasText: 'notes.txt' }).click()
  const code = page.getByTestId('code-editor')
  const editor = code.locator('.cm-content')
  await expect(editor).toContainText('word199')

  // Nothing to scroll sideways, and the long line takes several rows.
  const { scrollWidth, clientWidth } = await code.locator('.cm-scroller').evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  const lines = code.locator('.cm-line')
  const rows = await lines
    .nth(1)
    .evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
  expect(rows).toBeGreaterThan(1)

  // Still one real line: four lines (the last one empty), and number 3 sits beside "last", below the wrapped rows.
  await expect(lines).toHaveCount(4)
  const top = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().top)
  const three = code.locator('.cm-lineNumbers .cm-gutterElement').getByText('3', { exact: true })
  expect(Math.abs((await top(three)) - (await top(lines.nth(2))))).toBeLessThan(2)

  // Wrapping is only on screen: an edit saves as one line plus the edit, with no breaks added.
  await editor.click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type('end')
  await expect(page.getByTestId('dirty-dot')).toHaveCount(1)
  await page.keyboard.press('Meta+s')
  await expect(page.getByTestId('dirty-dot')).toHaveCount(0)
  await expect.poll(() => readFileSync(join(project, 'notes.txt'), 'utf8')).toBe(`${content}end`)
  await page.screenshot({ path: 'test-results/code-wrap.png' })

  await app.close()
})

test('code view: a wrapped file reopens where it was scrolled to', async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-project-')))
  // Paragraphs of uneven length, so line heights can't be guessed before they are measured.
  const paragraphs = Array.from({ length: 300 }, (_, i) => {
    const words = 5 + ((i * 37) % 120)
    return `P${i} ` + Array.from({ length: words }, (_, w) => 'x'.repeat(1 + ((i + w * 7) % 13))).join(' ')
  })
  writeFileSync(join(project, 'long.txt'), paragraphs.join('\n') + '\n')
  writeFileSync(join(project, 'other.txt'), 'other\n')
  const { app, page } = await openCode(project)

  await page.getByTestId('file-entry').filter({ hasText: 'long.txt' }).click()
  const code = page.getByTestId('code-editor')
  await expect(code.locator('.cm-content')).toContainText('P0 ')
  const scroller = code.locator('.cm-scroller')
  /** The paragraph at the top of the editor. */
  const topParagraph = () =>
    scroller.evaluate((el) => {
      const top = el.getBoundingClientRect().top
      const line = [...el.querySelectorAll('.cm-line')].find((l) => l.getBoundingClientRect().bottom > top + 1)
      return line?.textContent?.split(' ')[0]
    })

  // Scroll down the way a reader does, so the editor measures every paragraph on the way.
  await scroller.evaluate(async (el) => {
    const frame = () => new Promise((r) => requestAnimationFrame(r))
    while (el.scrollTop < el.scrollHeight * 0.7) {
      el.scrollTop += el.clientHeight / 2
      await frame()
      await frame()
    }
  })
  await expect.poll(topParagraph).toMatch(/^P\d+$/)
  // Let the editor measure what came into view; the top paragraph settles.
  await page.waitForTimeout(300)
  const before = await topParagraph()
  expect(before).not.toBe('P0')

  await page.getByTestId('file-entry').filter({ hasText: 'other.txt' }).click()
  await expect(code.locator('.cm-content')).toHaveText('other')
  await page.getByTestId('editor-tab').filter({ hasText: 'long.txt' }).click()
  await expect.poll(topParagraph).toBe(before)
  // And it stays there once the editor has measured what is on screen.
  await page.waitForTimeout(300)
  expect(await topParagraph()).toBe(before)

  await app.close()
})
