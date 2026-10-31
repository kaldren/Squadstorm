import { _electron as electron, expect, test, type ElectronApplication, type Locator } from '@playwright/test'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Stand-in for the agent CLIs: prints its arguments. When $SQUADSTORM_E2E_FAIL_RESUME is set it has
// nothing to resume and exits at once; when $SQUADSTORM_E2E_BUSY names a missing file it keeps
// printing (working) until that file exists. Then it echoes its input.
const FAKE_AGENT = `
echo "args=[$*]"
case " $* " in *" --resume "*) [ -n "$SQUADSTORM_E2E_FAIL_RESUME" ] && exit 1 ;; esac
case " $* " in *" --session-id $SQUADSTORM_E2E_USED "*) echo "Session ID already in use"; exit 1 ;; esac
if [ -n "$SQUADSTORM_E2E_BUSY" ]; then
  while [ ! -f "$SQUADSTORM_E2E_BUSY" ]; do echo working; sleep 0.1; done
fi
exec cat
`

function launch(userData: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: { ...process.env, SQUADSTORM_E2E: '1', SQUADSTORM_USER_DATA: userData, SQUADSTORM_AGENT_CMD: FAKE_AGENT, ...env }
  })
}

async function output(app: ElectronApplication, tile: Locator): Promise<string> {
  const id = await tile.getAttribute('data-agent-id')
  return app.evaluate((_electron, agentId) => (globalThis as any).__squadstormPtys.backlogs()[agentId!] ?? '', id)
}

async function setup(app: ElectronApplication, claudes: number) {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-resume-')))
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, project)
  const page = await app.firstWindow()
  for (let i = 1; i < claudes; i++) await page.getByTestId('count-claude').getByLabel('More').click()
  await page.getByTestId('pick-folder').click()
  await page.getByTestId('start').click()
  await expect(page.getByTestId('agent-tile')).toHaveCount(claudes)
  return page
}

test('claude agents resume their own session', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-'))
  let app = await launch(userData)
  let page = await setup(app, 2)
  let tiles = page.getByTestId('agent-tile')
  const ids = [await tiles.nth(0).getAttribute('data-agent-id'), await tiles.nth(1).getAttribute('data-agent-id')]
  for (const [i, id] of ids.entries()) await expect.poll(() => output(app, tiles.nth(i))).toContain(`args=[--session-id ${id}]`)
  // The first launch is saved as started before quitting.
  await page.waitForTimeout(500)
  await app.close()

  app = await launch(userData)
  page = await app.firstWindow()
  tiles = page.getByTestId('agent-tile')
  await expect(tiles).toHaveCount(2)
  for (const [i, id] of ids.entries()) {
    expect(await tiles.nth(i).getAttribute('data-agent-id')).toBe(id)
    await expect.poll(() => output(app, tiles.nth(i))).toContain(`args=[--resume ${id}]`)
  }

  // Restart after the agent exits resumes too.
  await tiles.nth(0).click()
  await page.keyboard.press('Control+d')
  await page.getByRole('button', { name: 'Restart' }).click()
  await expect.poll(() => output(app, tiles.nth(0))).toContain(`args=[--resume ${ids[0]}]`)
  await expect(tiles.nth(0).getByTestId('agent-activity')).toBeVisible()

  await app.close()
})

test('a failed resume starts fresh with a note', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-'))
  let app = await launch(userData)
  let page = await setup(app, 1)
  const id = await page.getByTestId('agent-tile').getAttribute('data-agent-id')
  await page.waitForTimeout(500)
  await app.close()

  app = await launch(userData, { SQUADSTORM_E2E_FAIL_RESUME: '1' })
  page = await app.firstWindow()
  const tile = page.getByTestId('agent-tile')
  await expect.poll(() => output(app, tile)).toContain("Couldn't resume the previous conversation; started a new one")
  // It starts over on a new session id: the old one may still be taken by the conversation that
  // wouldn't resume (spec Changelog, 2026-10-31).
  await expect.poll(() => output(app, tile)).toMatch(/args=\[--session-id [0-9a-f-]{36}\]/)
  expect(await output(app, tile)).not.toContain(`args=[--session-id ${id}]`)
  // Still running: the tile never showed the failed attempt as an exit.
  await expect(tile.getByRole('button', { name: 'Restart' })).toHaveCount(0)
  await app.close()
})

test('quitting asks while an agent is working', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-'))
  const done = join(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-busy-')), 'done')
  const app = await launch(userData, { SQUADSTORM_E2E_BUSY: done })
  const page = await setup(app, 1)
  const tile = page.getByTestId('agent-tile')
  await expect(tile.getByTestId('agent-activity')).toHaveAttribute('data-activity', 'working', { timeout: 10_000 })

  // Cancel: nothing quits, the agent keeps working.
  await app.evaluate(({ app: electronApp }) => {
    Object.assign(globalThis, { __squadstormQuitAnswer: 1 })
    electronApp.quit()
  })
  await page.waitForTimeout(500)
  expect(await app.evaluate(() => (globalThis as any).__squadstormQuitAsked)).toBe(1)
  await expect(tile.getByTestId('agent-activity')).toHaveAttribute('data-activity', 'working')

  // Once it's quiet (it then waits for you), quitting doesn't ask: with Cancel still the answer, the
  // app only closes if nobody asked.
  writeFileSync(done, '')
  await expect(tile.getByTestId('agent-waiting')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(300)
  await app.close()
})

test('a session that exists but won\'t resume gets a new one, which is resumed next time', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-'))
  let app = await launch(userData)
  let page = await setup(app, 1)
  const id = (await page.getByTestId('agent-tile').getAttribute('data-agent-id'))!
  await page.waitForTimeout(500)
  await app.close()

  // Resuming fails, and the agent's own id is taken: the fresh start needs a new session id.
  app = await launch(userData, { SQUADSTORM_E2E_FAIL_RESUME: '1', SQUADSTORM_E2E_USED: id })
  page = await app.firstWindow()
  let tile = page.getByTestId('agent-tile')
  await expect.poll(() => output(app, tile)).toMatch(/args=\[--session-id [0-9a-f-]{36}\]/)
  const fresh = (await output(app, tile)).match(/args=\[--session-id ([0-9a-f-]{36})\]/)![1]
  expect(fresh).not.toBe(id)
  await expect(tile.getByRole('button', { name: 'Restart' })).toHaveCount(0)
  await page.waitForTimeout(500)
  await app.close()

  // Next time, that new session is the one resumed.
  app = await launch(userData)
  page = await app.firstWindow()
  tile = page.getByTestId('agent-tile')
  await expect.poll(() => output(app, tile)).toContain(`args=[--resume ${fresh}]`)
  await app.close()
})

test('closing the window asks too, through the real dialog call', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-'))
  const done = join(mkdtempSync(join(tmpdir(), 'squadstorm-e2e-busy-')), 'done')
  const app = await launch(userData, { SQUADSTORM_E2E_BUSY: done })
  const page = await setup(app, 1)
  await expect(page.getByTestId('agent-tile').getByTestId('agent-activity')).toHaveAttribute('data-activity', 'working', { timeout: 10_000 })

  // Answer with whichever button says Cancel, and record what was asked.
  await app.evaluate(({ dialog, BrowserWindow }) => {
    const asked: string[] = []
    Object.assign(globalThis, { __asked: asked })
    dialog.showMessageBoxSync = ((...args: unknown[]) => {
      const options = args.at(-1) as { message: string; buttons: string[] }
      asked.push(options.message)
      return options.buttons.indexOf('Cancel')
    }) as typeof dialog.showMessageBoxSync
    BrowserWindow.getAllWindows()[0].close()
  })
  await page.waitForTimeout(500)
  expect(await app.evaluate(() => (globalThis as any).__asked)).toEqual(['1 agent is still working'])
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

  writeFileSync(done, '')
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
  })
  await app.close()
})

