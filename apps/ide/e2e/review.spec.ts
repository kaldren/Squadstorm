import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
const lines = (n: number, change: Record<number, string> = {}) =>
  Array.from({ length: n }, (_, i) => change[i + 1] ?? `line ${i + 1}`).join('\n') + '\n'

/**
 * A repo with three uncommitted changes: src/a.ts modified in two separate places, b.ts deleted, and
 * c.ts new.
 */
function project(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-review-')))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'e2e@example.com')
  git(dir, 'config', 'user.name', 'E2E')
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'a.ts'), lines(20))
  writeFileSync(join(dir, 'b.ts'), 'export const b = 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  writeFileSync(join(dir, 'src', 'a.ts'), lines(20, { 2: 'agent change one', 15: 'agent change two' }))
  rmSync(join(dir, 'b.ts'))
  writeFileSync(join(dir, 'c.ts'), 'one\ntwo\nthree\n')
  return dir
}

interface Session {
  app: ElectronApplication
  page: Page
  dir: string
  /** Answers for upcoming confirm dialogs; when empty, confirms are accepted. */
  answers: boolean[]
}

async function open(): Promise<Session> {
  const dir = project()
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      SQUADSTORM_E2E: '1',
      SQUADSTORM_USER_DATA: mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-')),
      SQUADSTORM_AGENT_CMD: 'exec cat'
    }
  })
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, dir)
  const page = await app.firstWindow()
  const session: Session = { app, page, dir, answers: [] }
  page.on('dialog', (d) => void (session.answers.shift() === false ? d.dismiss() : d.accept()))
  await page.getByTestId('pick-folder').click()
  await page.getByTestId('start').click()
  await page.getByRole('tab', { name: 'Code' }).click()
  return session
}

const read = (s: Session, path: string) => (existsSync(join(s.dir, path)) ? readFileSync(join(s.dir, path), 'utf8') : null)
const section = (s: Session, path: string) => s.page.locator(`[data-testid="review-file"][data-path="${path}"]`)

async function review(s: Session) {
  await s.page.getByRole('tab', { name: 'changes' }).click()
  await s.page.getByTestId('review-all').click()
  await expect(s.page.getByTestId('review-file')).toHaveCount(3)
}

test('review shows every change with line counts', async () => {
  const s = await open()
  await review(s)
  for (const line of git(s.dir, 'diff', '--numstat', 'HEAD').trim().split('\n')) {
    const [added, removed, path] = line.split('\t')
    await expect(section(s, path).getByTestId('review-stats')).toHaveText(`+${added} −${removed}`)
  }
  await expect(section(s, 'c.ts').getByTestId('review-stats')).toHaveText('+3 −0')
  await expect(section(s, 'src/a.ts')).toContainText('agent change two')
  await s.app.close()
})

test('discard a hunk', async () => {
  const s = await open()
  await review(s)
  const hunks = section(s, 'src/a.ts').getByTestId('discard-hunk')
  await expect(hunks).toHaveCount(2)
  await hunks.first().click()

  // Only the first change goes back; everything else is untouched.
  await expect.poll(() => read(s, 'src/a.ts')).toBe(lines(20, { 15: 'agent change two' }))
  expect(read(s, 'b.ts')).toBeNull()
  expect(read(s, 'c.ts')).toBe('one\ntwo\nthree\n')
  await expect(section(s, 'src/a.ts').getByTestId('discard-hunk')).toHaveCount(1)

  // Undo writes the discarded change back.
  await s.page.getByTestId('undo-discard').click()
  await expect.poll(() => read(s, 'src/a.ts')).toBe(lines(20, { 2: 'agent change one', 15: 'agent change two' }))
  await s.app.close()
})

test('discard a file', async () => {
  const s = await open()
  await review(s)

  // Cancelling changes nothing.
  s.answers.push(false)
  await section(s, 'src/a.ts').getByTestId('discard-file').click()
  await s.page.waitForTimeout(300)
  expect(read(s, 'src/a.ts')).toContain('agent change one')

  // A modified file goes back to HEAD, a deleted one comes back, a new one goes to the Trash.
  await section(s, 'src/a.ts').getByTestId('discard-file').click()
  await expect.poll(() => read(s, 'src/a.ts')).toBe(lines(20))
  await section(s, 'b.ts').getByTestId('discard-file').click()
  await expect.poll(() => read(s, 'b.ts')).toBe('export const b = 1\n')
  await section(s, 'c.ts').getByTestId('discard-file').click()
  await expect.poll(() => read(s, 'c.ts')).toBeNull()
  expect(await s.app.evaluate(() => (globalThis as any).__squadstormTrashed)).toEqual([join(s.dir, 'c.ts')])
  await expect(s.page.getByTestId('review-file')).toHaveCount(0)
  await s.app.close()
})

test('commit selected files', async () => {
  const s = await open()
  await s.page.getByRole('tab', { name: 'changes' }).click()
  const entry = (name: string) => s.page.getByTestId('change-entry').filter({ hasText: name })
  await entry('b.ts').getByTestId('change-check').uncheck()
  await entry('c.ts').getByTestId('change-check').uncheck()
  await s.page.getByLabel('Commit message').fill('Only a')
  await s.page.getByRole('button', { name: 'Commit 1 of 3' }).click()

  await expect.poll(() => git(s.dir, 'log', '-1', '--format=%s').trim()).toBe('Only a')
  expect(git(s.dir, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('src/a.ts')
  await expect(s.page.getByTestId('change-entry')).toHaveCount(2)
  await expect(entry('b.ts')).toHaveCount(1)
  await expect(entry('c.ts')).toHaveCount(1)
  await s.app.close()
})

test('tree marks changes', async () => {
  const s = await open()
  const entry = (path: string) => s.page.locator(`[data-testid="file-entry"][title="${path}"]`)
  await expect(entry('src')).toHaveAttribute('data-git', 'changed')
  await expect(entry('c.ts')).toHaveAttribute('data-git', 'A')
  await entry('src').click()
  await expect(entry('src/a.ts')).toHaveAttribute('data-git', 'M')
  await s.app.close()
})

/** A fresh repo with `files` committed, then `changes` applied (null deletes). */
function repoWith(files: Record<string, string>, changes: Record<string, string | null>): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-review-')))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'e2e@example.com')
  git(dir, 'config', 'user.name', 'E2E')
  const put = (path: string, content: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  for (const [path, content] of Object.entries(files)) put(path, content)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  for (const [path, content] of Object.entries(changes)) {
    if (content === null) rmSync(join(dir, path))
    else put(path, content)
  }
  return dir
}

async function openRepo(dir: string): Promise<Session> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SQUADSTORM_E2E: '1', SQUADSTORM_USER_DATA: mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-')), SQUADSTORM_AGENT_CMD: 'exec cat' }
  })
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, dir)
  const page = await app.firstWindow()
  const session: Session = { app, page, dir, answers: [] }
  page.on('dialog', (d) => void (session.answers.shift() === false ? d.dismiss() : d.accept()))
  await page.getByTestId('pick-folder').click()
  await page.getByTestId('start').click()
  await page.getByRole('tab', { name: 'Code' }).click()
  await page.getByRole('tab', { name: 'changes' }).click()
  await page.getByTestId('review-all').click()
  return session
}

test("a hunk discard or its undo never overwrites a newer change", async () => {
  const dir = repoWith({ 'a.ts': lines(20) }, { 'a.ts': lines(20, { 2: 'agent change one', 15: 'agent change two' }) })
  const s = await openRepo(dir)
  const hunks = section(s, 'a.ts').getByTestId('discard-hunk')
  await expect(hunks).toHaveCount(2)

  // The agent appends a line; the review hasn't caught up yet when Discard is clicked.
  writeFileSync(join(dir, 'a.ts'), lines(20, { 2: 'agent change one', 15: 'agent change two' }) + 'agent appended\n')
  await hunks.first().click()
  await s.page.waitForTimeout(800)
  expect(read(s, 'a.ts')).toContain('agent appended')

  // Undo after the agent edited the file again doesn't bring back the old text either.
  await expect(section(s, 'a.ts')).toContainText('agent appended')
  await section(s, 'a.ts').getByTestId('discard-hunk').first().click()
  await expect.poll(() => read(s, 'a.ts')).not.toContain('agent change one')
  writeFileSync(join(dir, 'a.ts'), read(s, 'a.ts') + 'agent again\n')
  await s.page.getByTestId('undo-discard').click()
  await s.page.waitForTimeout(500)
  expect(read(s, 'a.ts')).toContain('agent again')
  expect(read(s, 'a.ts')).not.toContain('agent change one')
  await s.app.close()
})

test('discarding a hunk keeps the line endings and leaves look-alike paths alone', async () => {
  const crlf = (text: string) => text.replace(/\n/g, '\r\n')
  const dir = repoWith(
    { 'win.ts': crlf(lines(20)), 'app/[id]/page.ts': 'a\n', 'app/i/page.ts': 'b\n', 'app/d/page.ts': 'c\n' },
    {
      'win.ts': crlf(lines(20, { 2: 'agent change one', 15: 'agent change two' })),
      'app/[id]/page.ts': 'a changed\n',
      'app/i/page.ts': 'b changed\n',
      'empty.ts': ''
    }
  )
  const s = await openRepo(dir)
  await section(s, 'win.ts').getByTestId('discard-hunk').first().click()
  await expect.poll(() => read(s, 'win.ts')).toBe(crlf(lines(20, { 15: 'agent change two' })))

  // `[id]` is a glob to git unless paths are taken literally.
  await section(s, 'app/[id]/page.ts').getByTestId('discard-file').click()
  await expect.poll(() => read(s, 'app/[id]/page.ts')).toBe('a\n')
  expect(read(s, 'app/i/page.ts')).toBe('b changed\n')

  // An empty new file adds no lines.
  await expect(section(s, 'empty.ts').getByTestId('review-stats')).toHaveText('+0 −0')
  await s.app.close()
})

test('committing a file whose name looks like a pattern commits only that file', async () => {
  const dir = repoWith({ 'app/[id]/page.ts': 'a\n', 'app/i/page.ts': 'b\n' }, { 'app/[id]/page.ts': 'a changed\n', 'app/i/page.ts': 'b changed\n' })
  const s = await openRepo(dir)
  await s.page.getByTestId('change-entry').filter({ hasText: 'i' }).filter({ hasNotText: '[id]' }).getByTestId('change-check').uncheck()
  await s.page.getByLabel('Commit message').fill('Only [id]')
  await s.page.getByRole('button', { name: 'Commit 1 of 2' }).click()
  await expect.poll(() => git(dir, 'log', '-1', '--format=%s').trim()).toBe('Only [id]')
  expect(git(dir, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('app/[id]/page.ts')
  await s.app.close()
})

test('the undo toast stays clickable on a small window', async () => {
  const dir = repoWith(
    Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.ts`, lines(40)])),
    Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.ts`, lines(40, { 2: `change ${i}`, 30: `more ${i}` })]))
  )
  const s = await openRepo(dir)
  await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600))
  await section(s, 'f0.ts').getByTestId('discard-hunk').first().click()
  await expect.poll(() => read(s, 'f0.ts')).toBe(lines(40, { 30: 'more 0' }))
  // Scroll a file's header right under the toast (on CI's smaller screen that happened by itself);
  // the toast must still be the one that gets the click.
  await expect(s.page.getByTestId('undo-discard')).toBeVisible()
  await expect(section(s, 'f4.ts').getByTestId('discard-file')).toBeAttached()
  const onTop = await s.page.evaluate(() => {
    const undo = document.querySelector('[data-testid="undo-discard"]')!
    const list = document.querySelector('[data-testid="review-view"] .overflow-y-auto') as HTMLElement
    const header = document.querySelector('[data-testid="review-file"][data-path="f4.ts"] > div') as HTMLElement
    list.scrollTop += header.getBoundingClientRect().top - undo.getBoundingClientRect().top
    const r = undo.getBoundingClientRect()
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === undo
  })
  expect(onTop).toBe(true)
  await s.page.getByTestId('undo-discard').click()
  await expect.poll(() => read(s, 'f0.ts')).toBe(lines(40, { 2: 'change 0', 30: 'more 0' }))
  await s.app.close()
})
