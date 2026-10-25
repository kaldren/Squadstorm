import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'leya-e2e-github-')))
const userData = join(root, 'data')
const gitBase = join(root, 'remote')
const reposDir = join(root, 'repos')

// Stands in for github.com/acme/widgets.
const origin = join(gitBase, 'acme', 'widgets.git')
mkdirSync(origin, { recursive: true })
const git = (...args: string[]) => execFileSync('git', ['-C', origin, ...args])
git('init', '-q', '-b', 'main')
writeFileSync(join(origin, 'README.md'), '# widgets\n')
git('add', '.')
git('-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'commit', '-qm', 'init')

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      LEYA_E2E: '1',
      LEYA_USER_DATA: userData,
      LEYA_GIT_BASE: gitBase,
      LEYA_REPOS_DIR: reposDir,
      LEYA_AGENT_CMD: 'echo "fake agent in $(pwd)"; exec cat'
    }
  })
}

test('clone a GitHub repo → agents run inside the clone', async () => {
  const app = await launch()
  const page = await app.firstWindow()
  await page.getByTestId('source-github').click()
  await expect(page.getByTestId('start')).toBeDisabled()
  await page.getByTestId('repo-input').fill('https://github.com/acme/widgets')
  await page.screenshot({ path: 'test-results/github-setup.png' })
  await page.getByTestId('start').click()

  const tile = page.getByTestId('agent-tile')
  await expect(tile).toHaveCount(1)
  const clone = join(reposDir, 'acme', 'widgets')
  expect(existsSync(join(clone, 'README.md'))).toBe(true)
  await expect(page.getByText('· acme/widgets')).toBeVisible()

  const id = await tile.getAttribute('data-agent-id')
  await expect
    .poll(() =>
      app.evaluate((_e, agentId) => (globalThis as any).__leyaPtys.backlogs()[agentId!] ?? '', id)
    )
    .toContain(`fake agent in ${clone}`)

  // A second workspace on the same repo reuses the clone; an unknown repo reports git's error.
  await page.getByLabel('New workspace').click()
  await page.getByTestId('source-github').click()
  await page.getByTestId('repo-input').fill('acme/missing')
  await page.getByTestId('start').click()
  await expect(page.getByText(/Could not clone acme\/missing/)).toBeVisible()
  expect(existsSync(join(reposDir, 'acme', 'missing'))).toBe(false)

  await page.getByTestId('repo-input').fill('acme/widgets')
  await page.getByTestId('start').click()
  // Inactive workspaces keep their terminals mounted, so count workspaces in the sidebar.
  await expect(page.getByText('· acme/widgets')).toHaveCount(2)
  await page.screenshot({ path: 'test-results/github-workspaces.png' })
  await app.close()
})
