import { defineConfig } from '@playwright/test'

// Tests pass this process's environment to the app, and through it to fake agents. When the suite
// runs from inside Claude Code, its CLAUDE_CODE_* variables would leak into every fake agent.
delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' }
})
