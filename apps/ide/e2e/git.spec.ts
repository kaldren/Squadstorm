import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })

test('changes: see diffs, commit and push', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-'))
  const remote = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-remote-')))
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-project-')))
  git(remote, 'init', '-q', '--bare', '-b', 'main')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'e2e@example.com')
  git(project, 'config', 'user.name', 'E2E')
  writeFileSync(join(project, 'a.txt'), 'one\ntwo\n')
  writeFileSync(join(project, 'old.txt'), 'bye\n')
  git(project, 'add', '-A')
  git(project, 'commit', '-q', '-m', 'init')
  git(project, 'remote', 'add', 'origin', remote)
  git(project, 'push', '-q', '-u', 'origin', 'main')

  // What an agent might leave behind.
  writeFileSync(join(project, 'a.txt'), 'one\nTWO\n')
  writeFileSync(join(project, 'new.txt'), 'hi\n')
  unlinkSync(join(project, 'old.txt'))

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
  await page.getByRole('tab', { name: /changes/i }).click()
  const changes = page.getByTestId('change-entry')
  await expect(changes).toHaveCount(3)
  await expect(changes.filter({ hasText: 'a.txt' })).toContainText('M')
  await expect(changes.filter({ hasText: 'new.txt' })).toContainText('A')
  await expect(changes.filter({ hasText: 'old.txt' })).toContainText('D')

  // The diff shows the removed and the added line.
  await changes.filter({ hasText: 'a.txt' }).click()
  const diff = page.getByTestId('diff-view')
  await expect(diff.locator('.cm-deletedChunk')).toContainText('two')
  await expect(diff.locator('.cm-changedLine')).toContainText('TWO')
  await page.screenshot({ path: 'test-results/changes.png' })

  // Commit everything, then push.
  const push = page.getByRole('button', { name: /^Push/ })
  await expect(push).toBeDisabled()
  await page.getByLabel('Commit message').fill('Agent work')
  await page.getByRole('button', { name: /^Commit/ }).click()
  await expect(changes).toHaveCount(0)
  await expect(diff).toHaveCount(0)
  expect(git(project, 'log', '-1', '--format=%s').trim()).toBe('Agent work')
  await expect(push).toHaveText('Push ↑1')
  await push.click()
  await expect(push).toHaveText('Push')
  expect(git(remote, 'log', '-1', '--format=%s', 'main').trim()).toBe('Agent work')

  // History lists both commits, newest first, with the branch on the tip.
  await page.getByRole('tab', { name: /history/i }).click()
  const commits = page.getByTestId('commit-entry')
  await expect(commits).toHaveCount(2)
  await expect(commits.first()).toContainText('Agent work')
  await expect(commits.first()).toContainText('main')
  await expect(commits.nth(1)).toContainText('init')

  // Clicking a commit lists its files; clicking a file shows what the commit did to it.
  await commits.first().click()
  const commitFiles = page.getByTestId('commit-file')
  await expect(commitFiles).toHaveCount(3)
  await commitFiles.filter({ hasText: 'a.txt' }).click()
  await expect(diff).toContainText('Agent work')
  await expect(diff.locator('.cm-deletedChunk')).toContainText('two')
  await expect(diff.locator('.cm-changedLine')).toContainText('TWO')
  // The root commit is compared with nothing, so all of its lines are new.
  await commits.first().click()
  await expect(commitFiles).toHaveCount(0)
  await commits.nth(1).click()
  await expect(commitFiles).toHaveCount(2)
  await commitFiles.filter({ hasText: 'old.txt' }).click()
  await expect(diff).toContainText('init')
  await expect(diff.locator('.cm-changedLine')).toContainText('bye')
  await page.screenshot({ path: 'test-results/history.png' })

  await app.close()
})
