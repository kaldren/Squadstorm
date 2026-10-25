import { _electron as electron, expect, test, type ElectronApplication, type Locator } from '@playwright/test'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'vibe-e2e-data-'))
const project = realpathSync(mkdtempSync(join(tmpdir(), 'vibe-e2e-project-')))

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      VIBE_E2E: '1',
      VIBE_USER_DATA: userData,
      // Stand-in for claude/codex: prints its cwd, then echoes input.
      VIBE_AGENT_CMD: 'echo "fake agent in $(pwd)"; exec cat'
    }
  })
}

async function output(app: ElectronApplication, tile: Locator): Promise<string> {
  const id = await tile.getAttribute('data-agent-id')
  return app.evaluate((_electron, agentId) => {
    const ptys = (globalThis as any).__vibePtys
    return ptys.backlogs()[agentId!] ?? ''
  }, id)
}

test('setup → agent grid → add/remove → restored on relaunch', async () => {
  let app = await launch()
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, project)

  let page = await app.firstWindow()
  await page.getByTestId('count-claude').getByLabel('More').click() // 2 Claude
  await page.getByTestId('count-codex').getByLabel('More').click() // 1 Codex
  await page.getByTestId('pick-folder').click()
  await page.getByTestId('start').click()

  const tiles = page.getByTestId('agent-tile')
  await expect(tiles).toHaveCount(3)
  await expect(tiles.nth(2)).toContainText('Codex 1')
  for (let i = 0; i < 3; i++) await expect(tiles.nth(i)).toContainText('online')

  // Every agent runs in the project folder.
  await expect.poll(() => output(app, tiles.first())).toContain(`fake agent in ${project}`)

  // Input reaches the right pty only.
  await tiles.nth(1).click()
  await page.keyboard.type('hello agent two\r')
  await expect.poll(() => output(app, tiles.nth(1))).toContain('hello agent two')
  expect(await output(app, tiles.nth(0))).not.toContain('hello agent two')

  await page.screenshot({ path: 'test-results/grid.png' })

  // Three tiles: two on top, the third stretches across the bottom row.
  const box = async (i: number) => (await tiles.nth(i).boundingBox())!
  const [top0, top1, bottom] = [await box(0), await box(1), await box(2)]
  expect(bottom.width).toBeGreaterThan(top0.width + top1.width)

  // Dragging dividers resizes tiles on both axes.
  const drag = async (divider: Locator, dx: number, dy: number) => {
    const d = (await divider.boundingBox())!
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2)
    await page.mouse.down()
    await page.mouse.move(d.x + d.width / 2 + dx, d.y + d.height / 2 + dy, { steps: 5 })
    await page.mouse.up()
  }
  await drag(page.getByTestId('grid-divider-col'), 120, 0)
  expect((await box(0)).width).toBeCloseTo(top0.width + 120, -1)
  expect((await box(1)).width).toBeCloseTo(top1.width - 120, -1)
  await drag(page.getByTestId('grid-divider-row'), 0, 80)
  expect((await box(0)).height).toBeCloseTo(top0.height + 80, -1)
  expect((await box(2)).height).toBeCloseTo(bottom.height - 80, -1)
  await page.screenshot({ path: 'test-results/resized.png' })

  // Maximize one agent, then restore the grid; hidden agents keep running.
  await page.getByLabel('Maximize Claude 2').click()
  await expect(tiles.nth(1)).toBeVisible()
  await expect(tiles.nth(0)).toBeHidden()
  await expect(tiles.nth(2)).toBeHidden()
  await expect(page.getByLabel('Maximize Claude 2')).toBeDisabled()
  await page.screenshot({ path: 'test-results/maximized.png' })
  await page.getByLabel('Restore Claude 2').click()
  for (let i = 0; i < 3; i++) await expect(tiles.nth(i)).toBeVisible()
  await expect(tiles.nth(0)).toContainText('online')

  await page.getByRole('button', { name: '+ Codex' }).click()
  await expect(tiles).toHaveCount(4)
  const removedId = await tiles.first().getAttribute('data-agent-id')
  await page.getByLabel('Remove Claude 1').click()
  await expect(tiles).toHaveCount(3)
  const live = await app.evaluate(() => Object.keys((globalThis as any).__vibePtys.backlogs()))
  expect(live).not.toContain(removedId)
  expect(live).toHaveLength(3)

  // Drag Codex 2 onto Claude 2's slot; the moved agent keeps its running session.
  const movedId = await tiles.nth(2).getAttribute('data-agent-id')
  await tiles.nth(2).getByTestId('agent-drag-handle').dragTo(tiles.nth(0))
  await expect(tiles.nth(0)).toContainText('Codex 2')
  await expect(tiles.nth(1)).toContainText('Claude 2')
  await expect(tiles.nth(2)).toContainText('Codex 1')
  expect(await tiles.nth(0).getAttribute('data-agent-id')).toBe(movedId)
  await expect(tiles.nth(0)).toContainText('online')

  // Plain terminals sit in the same grid as agents.
  await page.getByRole('button', { name: '+ Terminal' }).click()
  await expect(tiles).toHaveCount(4)
  await expect(tiles.nth(3)).toContainText('Terminal 1')
  await expect(tiles.nth(3)).toContainText('online')

  await app.close()

  // Relaunch: workspace and agent configs come back with fresh sessions.
  app = await launch()
  page = await app.firstWindow()
  const restored = page.getByTestId('agent-tile')
  await expect(restored).toHaveCount(4)
  // Order survives the relaunch.
  await expect(restored.nth(0)).toContainText('Codex 2')
  await expect(restored.nth(1)).toContainText('Claude 2')
  await expect(restored.nth(2)).toContainText('Codex 1')
  await expect(restored.nth(3)).toContainText('Terminal 1')
  await app.close()
})
