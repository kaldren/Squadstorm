import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

// Stand-in for the agent CLIs. Agents wait a second, stream output for ~2.5 s (so they count as
// working) while reporting progress through ConEmu's OSC 9;4 (not a request for attention), and then
// go quiet, or post an OSC 9 notification first when their folder has a .notify file. The Terminal
// ($1 = -l) prints the same kind of bursts, then rings the bell once $SQUADSTORM_E2E_BELL exists.
const FAKE_AGENT = `
if [ "$1" = "-l" ]; then
  i=0; while [ $i -lt 25 ]; do echo "burst $i"; sleep 0.1; i=$((i+1)); done
  while [ ! -f "$SQUADSTORM_E2E_BELL" ]; do sleep 0.2; done
  printf 'ding\\a\\n'
else
  sleep 1
  i=0; while [ $i -lt 25 ]; do printf 'tick %s\\033]9;4;1;%s\\007\\n' $i $((i*4)); sleep 0.1; i=$((i+1)); done
  if [ -f .notify ]; then printf '\\033]9;All tests pass\\007'; fi
fi
exec cat
`

interface Notice {
  agentId: string
  title: string
  body: string
}

async function launch(folders: string[], bell = join(tmpdir(), 'squadstorm-no-bell')): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      SQUADSTORM_E2E: '1',
      SQUADSTORM_USER_DATA: mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-')),
      SQUADSTORM_AGENT_CMD: FAKE_AGENT,
      SQUADSTORM_E2E_BELL: bell
    }
  })
  // Each "Choose a folder" picks the next folder.
  await app.evaluate(({ dialog }, queue) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [queue.shift()!] })
  }, folders)
  const page = await app.firstWindow()
  // The window counts as in the background: notifications are only sent then.
  await page.evaluate(() => {
    document.hasFocus = () => false
  })
  return { app, page }
}

const notices = (app: ElectronApplication) =>
  app.evaluate(() => ((globalThis as any).__squadstormNotifications as Notice[]).map(({ agentId, title, body }) => ({ agentId, title, body })))
const badge = (app: ElectronApplication) => app.evaluate(() => (globalThis as any).__squadstormBadge as string)
const project = () => realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-project-')))

test('notifies when a background agent finishes', async () => {
  const folder = project()
  const { app, page } = await launch([folder])
  await page.getByTestId('pick-folder').click()
  await page.getByTestId('start').click()

  const tile = page.getByTestId('agent-tile')
  await expect(tile.getByTestId('agent-activity')).toHaveAttribute('data-activity', 'working', { timeout: 10_000 })
  await expect(tile).toHaveAttribute('data-attention', 'waiting', { timeout: 15_000 })
  await expect(tile.getByTestId('agent-waiting')).toBeVisible()

  // Exactly one notification, naming the agent and its workspace; the dock shows one waiting.
  await expect.poll(() => notices(app)).toHaveLength(1)
  const [notice] = await notices(app)
  expect(notice.title).toBe(`Claude 1 in ${basename(folder)}`)
  // Progress reports (OSC 9;4) are not notifications.
  expect(notice.body).toBe('Finished, or waiting for your input.')
  expect(notice.agentId).toBe(await tile.getAttribute('data-agent-id'))
  await expect.poll(() => badge(app)).toBe('1')
  await page.waitForTimeout(1500)
  expect(await notices(app)).toHaveLength(1)

  // Look elsewhere, then click the notification: it brings the agent back and focuses it.
  await page.getByRole('tab', { name: 'Code' }).click()
  await expect(tile).toBeHidden()
  await page.evaluate(() => {
    document.hasFocus = () => true
  })
  await app.evaluate(() => (globalThis as any).__squadstormNotifications[0].click())
  await expect(tile).toBeVisible()
  await expect(tile).toHaveAttribute('data-focused', 'true')
  await expect(tile).not.toHaveAttribute('data-attention')
  await expect.poll(() => badge(app)).toBe('')

  await app.close()
})

test('sidebar counts working and waiting agents; a notification switches workspace', async () => {
  const first = project()
  const second = project()
  // The second workspace's agent says why it stopped.
  writeFileSync(join(second, '.notify'), '')
  const { app, page } = await launch([first, second])
  await page.getByTestId('pick-folder').click()
  await page.getByTestId('start').click()
  await expect(page.getByTestId('agent-tile')).toHaveAttribute('data-attention', 'waiting', { timeout: 15_000 })

  // A second workspace: the first one's agent waits in the background while the new one works.
  await page.getByLabel('New workspace').click()
  await page.getByTestId('pick-folder').click()
  await page.getByTestId('start').click()
  const entry = (name: string) => page.locator('nav [role="button"]').filter({ hasText: name })
  const secondTile = page.getByTestId('agent-tile').nth(1)
  await expect(entry(basename(first)).getByTestId('workspace-attention')).toHaveText('1 waiting')
  await expect(entry(basename(second)).getByTestId('workspace-attention')).toHaveText('1 working', { timeout: 10_000 })
  await expect(secondTile.getByTestId('agent-activity')).toHaveAttribute('data-activity', 'working')
  await expect(entry(basename(second)).getByTestId('workspace-attention')).toHaveText('1 waiting', { timeout: 15_000 })
  await expect(secondTile.getByTestId('agent-waiting')).toBeVisible()
  await expect.poll(() => badge(app)).toBe('2')
  // Its OSC 9 text is the notification body.
  await expect.poll(async () => (await notices(app)).map((n) => n.body)).toContain('All tests pass')

  // Back in the window, clicking into a waiting tile clears it.
  await page.evaluate(() => {
    document.hasFocus = () => true
  })
  await secondTile.click()
  await expect(secondTile).not.toHaveAttribute('data-attention')
  await expect(entry(basename(second)).getByTestId('workspace-attention')).toHaveCount(0)
  await expect.poll(() => badge(app)).toBe('1')

  // The first workspace's notification brings that workspace back and focuses its agent.
  const firstTile = page.getByTestId('agent-tile').first()
  const firstId = await firstTile.getAttribute('data-agent-id')
  await expect(firstTile).toBeHidden()
  await app.evaluate((_electron, id) => {
    const all = (globalThis as any).__squadstormNotifications as { agentId: string; click(): void }[]
    all.find((n) => n.agentId === id)!.click()
  }, firstId)
  await expect(entry(basename(first))).toHaveAttribute('aria-current', 'true')
  await expect(firstTile).toBeVisible()
  await expect(firstTile).toHaveAttribute('data-focused', 'true')
  await expect.poll(() => badge(app)).toBe('')

  await app.close()
})

test('terminals only ask for attention with a bell', async () => {
  const folder = project()
  const bell = join(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-bell-')), 'ring')
  const { app, page } = await launch([folder], bell)
  await page.getByTestId('count-claude').getByLabel('Fewer').click()
  await page.getByTestId('count-terminal').getByLabel('More').click()
  await page.getByTestId('pick-folder').click()
  await page.getByTestId('start').click()

  // Bursts of routine output come and go without making the terminal wait.
  const tile = page.getByTestId('agent-tile')
  await expect(tile.getByTestId('agent-activity')).toHaveAttribute('data-activity', 'working', { timeout: 10_000 })
  await expect(tile.getByTestId('agent-activity')).not.toHaveAttribute('data-activity', 'working', { timeout: 10_000 })
  await page.waitForTimeout(1000)
  await expect(tile).not.toHaveAttribute('data-attention')
  expect(await notices(app)).toHaveLength(0)

  // A bell does.
  writeFileSync(bell, '')
  await expect(tile).toHaveAttribute('data-attention', 'waiting', { timeout: 10_000 })
  await expect.poll(() => notices(app)).toHaveLength(1)
  expect((await notices(app))[0].title).toBe(`Terminal 1 in ${basename(folder)}`)
  await expect.poll(() => badge(app)).toBe('1')

  // Reloading the window replays the terminal's output, bell included: no second notification, and
  // the dock badge starts over with the fresh window.
  await page.reload()
  await page.evaluate(() => {
    document.hasFocus = () => false
  })
  await expect(tile).toContainText('Terminal 1')
  await page.waitForTimeout(1500)
  await expect(tile).not.toHaveAttribute('data-attention')
  expect(await notices(app)).toHaveLength(1)
  await expect.poll(() => badge(app)).toBe('')

  await app.close()
})
