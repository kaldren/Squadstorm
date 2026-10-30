import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Stand-in for the agent CLIs: says where it runs and on which branch, then runs whatever the test
// types, so the test can make an agent write and commit files in its own folder.
const FAKE_AGENT = 'echo "pwd=$(pwd)"; echo "branch=$(git branch --show-current)"; exec sh'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })

function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-repo-')))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'e2e@example.com')
  git(dir, 'config', 'user.name', 'E2E')
  writeFileSync(join(dir, 'README.md'), '# app\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

interface Session {
  app: ElectronApplication
  page: Page
  /** Messages of confirm/alert dialogs so far. */
  dialogs: string[]
  /** Answers for upcoming confirm dialogs, in order; when empty, confirms are accepted. */
  answers: boolean[]
}

async function launch(project: string): Promise<Session> {
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      SQUADSTORM_E2E: '1',
      SQUADSTORM_USER_DATA: mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-')),
      SQUADSTORM_WORKTREES_DIR: realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-worktrees-'))),
      SQUADSTORM_AGENT_CMD: FAKE_AGENT
    }
  })
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, project)
  const page = await app.firstWindow()
  const session: Session = { app, page, dialogs: [], answers: [] }
  page.on('dialog', (d) => {
    session.dialogs.push(d.message())
    void (d.type() === 'confirm' && session.answers.shift() === false ? d.dismiss() : d.accept())
  })
  return session
}

async function output(app: ElectronApplication, tile: Locator): Promise<string> {
  const id = await tile.getAttribute('data-agent-id')
  return app.evaluate((_electron, agentId) => (globalThis as any).__squadstormPtys.backlogs()[agentId!] ?? '', id)
}

/** The folder an agent reports it runs in. */
async function cwdOf(app: ElectronApplication, tile: Locator): Promise<string> {
  await expect.poll(() => output(app, tile)).toMatch(/pwd=\S+/)
  return (await output(app, tile)).match(/pwd=(\S+)/)![1]
}

async function run(page: Page, tile: Locator, command: string) {
  await tile.click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

async function start(s: Session, { codex = 0, isolate = true } = {}) {
  for (let i = 0; i < codex; i++) await s.page.getByTestId('count-codex').getByLabel('More').click()
  await s.page.getByTestId('pick-folder').click()
  const box = s.page.getByTestId('isolate')
  await expect(box).toBeVisible()
  if (isolate) await box.check()
  await s.page.getByTestId('start').click()
}

test('isolated agents work in their own worktrees', async () => {
  const project = repo()
  const s = await launch(project)
  await start(s, { codex: 1 })

  const tiles = s.page.getByTestId('agent-tile')
  await expect(tiles).toHaveCount(2)
  await expect(tiles.nth(0).getByTestId('agent-branch')).toHaveText(/^squadstorm\/claude-1-[0-9a-f]{4}$/)
  await expect(tiles.nth(1).getByTestId('agent-branch')).toHaveText(/^squadstorm\/codex-1-[0-9a-f]{4}$/)

  // Each agent runs in its own folder, on its own branch.
  const [claude, codex] = [await cwdOf(s.app, tiles.nth(0)), await cwdOf(s.app, tiles.nth(1))]
  expect(claude).not.toBe(project)
  expect(codex).not.toBe(project)
  expect(claude).not.toBe(codex)
  expect(await output(s.app, tiles.nth(0))).toContain('branch=squadstorm/claude-1-')
  expect(await output(s.app, tiles.nth(1))).toContain('branch=squadstorm/codex-1-')

  // What one agent writes stays in its worktree.
  await run(s.page, tiles.nth(0), 'echo hi > wt-only.txt')
  await expect.poll(() => existsSync(join(claude, 'wt-only.txt'))).toBe(true)
  expect(existsSync(join(codex, 'wt-only.txt'))).toBe(false)
  expect(existsSync(join(project, 'wt-only.txt'))).toBe(false)

  // The workspace's own code view never sees worktrees: not in Quick Open, not in Changes.
  await s.page.getByRole('tab', { name: 'Code' }).click()
  await s.page.getByTestId('quick-open').click()
  await s.page.getByTestId('quick-open-input').fill('wt-only')
  await expect(s.page.getByRole('dialog', { name: 'Go to file' })).toContainText('No matching files')
  await s.page.keyboard.press('Escape')
  await s.page.getByRole('tab', { name: 'changes' }).click()
  await expect(s.page.getByText('No changes.')).toBeVisible()

  // Scoped to Claude 1's worktree, the code view shows its change and diff.
  const scope = s.page.getByTestId('code-scope')
  await scope.selectOption({ label: await scope.locator('option', { hasText: 'Claude 1' }).innerText() })
  await s.page.getByRole('tab', { name: 'changes' }).filter({ visible: true }).click()
  const change = s.page.getByTestId('change-entry').filter({ hasText: 'wt-only.txt', visible: true })
  await expect(change).toHaveCount(1)
  await change.click()
  await expect(s.page.getByTestId('diff-view').filter({ visible: true })).toContainText('wt-only.txt')

  await s.app.close()
})

test("merge brings an agent's commits back", async () => {
  const project = repo()
  const s = await launch(project)
  await start(s)
  const tile = s.page.getByTestId('agent-tile')
  const worktree = await cwdOf(s.app, tile)

  await run(s.page, tile, 'echo feature > feature.txt && git add -A && git commit -qm "Agent work"')
  await expect.poll(() => git(worktree, 'log', '-1', '--format=%s').trim()).toBe('Agent work')

  await tile.getByTestId('agent-menu').click()
  await s.page.getByTestId('agent-merge').click()
  await expect(tile.getByTestId('agent-message')).toContainText('Merged 1 commit from Claude 1 into main')
  expect(git(project, 'log', '--format=%s', 'main')).toContain('Agent work')
  expect(existsSync(join(project, 'feature.txt'))).toBe(true)

  // Merging again has nothing to bring.
  await tile.getByTestId('agent-menu').click()
  await s.page.getByTestId('agent-merge').click()
  await expect(tile.getByTestId('agent-message')).toContainText('Nothing to merge')

  await s.app.close()
})

test('removing an agent', async () => {
  const project = repo()
  const s = await launch(project)
  await start(s)
  const tiles = s.page.getByTestId('agent-tile')
  const branches = () => git(project, 'branch', '--list', 'squadstorm/*', '--format=%(refname:short)').trim()
  const remove = (label: string) => s.page.getByRole('button', { name: `Remove ${label}` }).click()

  // Clean, with nothing of its own: worktree and branch go without a question.
  const clean = await cwdOf(s.app, tiles.first())
  await remove('Claude 1')
  await expect(tiles).toHaveCount(0)
  await expect.poll(() => existsSync(clean)).toBe(false)
  expect(branches()).toBe('')
  expect(s.dialogs).toEqual([])

  // Uncommitted changes: asks first; cancelling keeps everything. (With no agents left, the next one is
  // Claude 1 again.)
  await s.page.getByRole('button', { name: '+ Claude' }).click()
  await expect(tiles).toHaveCount(1)
  const dirty = await cwdOf(s.app, tiles.first())
  await run(s.page, tiles.first(), 'echo wip > wip.txt')
  await expect.poll(() => existsSync(join(dirty, 'wip.txt'))).toBe(true)
  s.answers.push(false)
  await remove('Claude 1')
  await expect.poll(() => s.dialogs.length).toBe(1)
  expect(s.dialogs[0]).toContain('Discard uncommitted changes in the worktree of Claude 1 (1 change)')
  await expect(tiles).toHaveCount(1)
  expect(existsSync(join(dirty, 'wip.txt'))).toBe(true)
  await remove('Claude 1')
  await expect(tiles).toHaveCount(0)
  await expect.poll(() => existsSync(dirty)).toBe(false)
  expect(branches()).toBe('')

  // Commits that aren't merged: the worktree goes, the branch stays, and it says so.
  await s.page.getByRole('button', { name: '+ Claude' }).click()
  const committed = await cwdOf(s.app, tiles.first())
  await run(s.page, tiles.first(), 'echo done > done.txt && git add -A && git commit -qm "Unmerged work"')
  await expect.poll(() => git(committed, 'log', '-1', '--format=%s').trim()).toBe('Unmerged work')
  await remove('Claude 1')
  await expect(tiles).toHaveCount(0)
  await expect.poll(() => existsSync(committed)).toBe(false)
  expect(branches()).toMatch(/^squadstorm\/claude-1-[0-9a-f]{4}$/)
  expect(s.dialogs.at(-1)).toMatch(/^Kept squadstorm\/claude-1-[0-9a-f]{4}: it has commits that aren't merged yet\.$/)

  await s.app.close()
})
