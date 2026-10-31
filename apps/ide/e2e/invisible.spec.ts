import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('e2e runs stay invisible: no window on screen, no Dock icon', async () => {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, SQUADSTORM_E2E: '1', SQUADSTORM_USER_DATA: mkdtempSync(join(tmpdir(), 'squadstorm-e2e-data-')) }
  })
  const page = await app.firstWindow()
  // The app still renders and works: the setup screen is there.
  await expect(page.getByTestId('pick-folder')).toBeVisible()
  const state = await app.evaluate(({ app: electronApp, BrowserWindow }) => ({
    windowShown: BrowserWindow.getAllWindows().some((w) => w.isVisible()),
    inDock: electronApp.dock?.isVisible() ?? false
  }))
  expect(state).toEqual({ windowShown: false, inDock: false })
  await app.close()
})
