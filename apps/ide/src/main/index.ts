import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { join } from 'node:path'
import type { AttentionNotice, SpawnRequest } from '@shared/api'
import type { FileChange } from '@shared/git'
import type { AgentWorktree } from '@shared/types'
import type { SearchQuery } from '@shared/search'
import type { AppState } from '@shared/types'
import { FileWatchers, listDir, readText, writeText, writeTextIfUnchanged } from './files'
import { gitCommit, gitCommitDiff, gitCommitFiles, gitDiff, gitDiscard, gitLog, gitNumstat, gitPush, gitStatus } from './git'
import { cloneRepo, githubStatus, listRepos } from './github'
import { PtyManager } from './pty'
import { allFiles, searchWorkspace } from './search'
import { addWorktree, inspectWorktree, mergeWorktree, openWorktreePr, removeWorktree } from './worktrees'
import { migrateFromOldNames } from './migrate'
import { loadState, saveState } from './store'

// e2e tests: the quit question answers `__squadstormQuitAnswer` (quit unless a test says otherwise)
// and is counted; a test can still replace this with its own stub.
if (process.env.SQUADSTORM_E2E) {
  const hooks = globalThis as { __squadstormQuitAsked?: number; __squadstormQuitAnswer?: number }
  dialog.showMessageBoxSync = (() => {
    hooks.__squadstormQuitAsked = (hooks.__squadstormQuitAsked ?? 0) + 1
    return hooks.__squadstormQuitAnswer ?? 0
  }) as typeof dialog.showMessageBoxSync
}

// Lets tests run against a throwaway profile.
if (process.env.SQUADSTORM_USER_DATA) app.setPath('userData', process.env.SQUADSTORM_USER_DATA)
else migrateFromOldNames()

let mainWindow: BrowserWindow | null = null

const ptys = new PtyManager((channel, id, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, id, payload)
})

const fileWatchers = new FileWatchers((root, paths) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('files:changed', root, paths)
})

const searchIds = new Map<string, number>()

// Terminal text is drawn on a WebGL canvas, so e2e tests read pty output from here instead.
if (process.env.SQUADSTORM_E2E) Object.assign(globalThis, { __squadstormPtys: ptys })

// e2e tests read notifications and the dock badge from here, and real notifications stay off screen.
const recordedNotices: (AttentionNotice & { click(): void })[] = []
if (process.env.SQUADSTORM_E2E) Object.assign(globalThis, { __squadstormNotifications: recordedNotices, __squadstormBadge: '' })

// The latest notification per agent, held so it isn't garbage-collected (it would stop reporting
// clicks). A newer one for the same agent replaces it, which keeps this bounded by the agent count.
const shownNotices = new Map<string, Notification>()

/** Renderer input is untrusted: plain single-line text of bounded length. */
const cleanText = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, max) : ''

/** Brings the window forward and tells the renderer which agent to show. */
function showAgent(agentId: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  app.focus({ steal: true })
  mainWindow.webContents.send('attention:clicked', agentId)
}

function notify(input: AttentionNotice): void {
  const notice = { agentId: cleanText(input?.agentId, 100), title: cleanText(input?.title, 120), body: cleanText(input?.body, 240) }
  if (!notice.agentId || !notice.title) return
  const click = () => showAgent(notice.agentId)
  if (process.env.SQUADSTORM_E2E) {
    recordedNotices.push({ ...notice, click })
    return
  }
  if (!Notification.isSupported()) return
  shownNotices.get(notice.agentId)?.close()
  const shown = new Notification({ title: notice.title, body: notice.body })
  shownNotices.set(notice.agentId, shown)
  const forget = () => {
    if (shownNotices.get(notice.agentId) === shown) shownNotices.delete(notice.agentId)
  }
  shown.on('click', () => {
    forget()
    click()
  })
  shown.on('close', forget)
  shown.show()
}

/** How many agents are working, as last reported by the window. */
let workingCount = 0
/** Set once the user agreed to stop working agents (or none were working), so nobody asks twice. */
let stopConfirmed = false

/** True from `before-quit` on, to word the question for quitting rather than closing the window. */
let quitting = false

/** Quitting or closing the window stops every agent. With some still working, ask first. */
function confirmStop(): boolean {
  if (stopConfirmed || workingCount === 0) return true
  const message = `${workingCount} agent${workingCount === 1 ? ' is' : 's are'} still working`
  const options = {
    type: 'warning' as const,
    buttons: [quitting ? 'Quit' : 'Close', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message,
    detail: `${quitting ? 'Quitting' : 'Closing the window'} stops them in the middle of their work.`
  }
  const answer = mainWindow ? dialog.showMessageBoxSync(mainWindow, options) : dialog.showMessageBoxSync(options)
  stopConfirmed = answer === 0
  return stopConfirmed
}

function setBadge(count: unknown): void {
  const text = Number.isInteger(count) && (count as number) > 0 ? String(count) : ''
  if (process.env.SQUADSTORM_E2E) Object.assign(globalThis, { __squadstormBadge: text })
  else app.dock?.setBadge(text)
}

/**
 * e2e runs keep the app invisible: the window is never shown and the app stays out of the Dock, so a
 * test run doesn't take over the screen. SQUADSTORM_E2E_SHOW=1 shows it, to watch a run.
 */
const invisible = !!process.env.SQUADSTORM_E2E && !process.env.SQUADSTORM_E2E_SHOW

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0e0f12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A window that is never shown would otherwise have its timers and rendering throttled.
      backgroundThrottling: !invisible
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (!invisible) mainWindow?.show()
  })
  // A fresh page starts with no waiting or working agents (it re-counts them).
  mainWindow.webContents.on('did-start-loading', () => {
    setBadge(0)
    workingCount = 0
  })

  // Links printed by agents (auth URLs, docs) open in the real browser, never inside the app.
  // The window only ever shows the app: a file dropped outside a tile, or a stray link, must not
  // replace it (a loaded page would get the app's bridge to agents and files).
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      // e2e tests check what would have opened instead of launching a browser.
      if (process.env.SQUADSTORM_E2E) ((globalThis as any).__squadstormOpened ??= []).push(url)
      else void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('close', (e) => {
    if (!confirmStop()) e.preventDefault()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    setBadge(0)
    // A new window starts over: its agents get the question again.
    stopConfirmed = false
    workingCount = 0
  })
}

function registerIpc(): void {
  ipcMain.handle('state:load', () => loadState())
  ipcMain.handle('state:save', (_e, state: AppState) => saveState(state))

  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose a project folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('providers:list', () => ptys.availability())

  ipcMain.handle('github:status', () => githubStatus())
  ipcMain.handle('github:repos', () => listRepos())
  ipcMain.handle('github:clone', (e, repo: string) =>
    cloneRepo(repo, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send('github:cloneProgress', line)
    })
  )

  ipcMain.handle('files:list', (_e, root: string, dir: string) => listDir(root, dir))
  ipcMain.handle('files:all', (_e, root: string) => allFiles(root))
  ipcMain.handle('files:search', (_e, root: string, query: SearchQuery) => {
    // Only the newest search per root matters; older ones stop at the next file.
    const id = (searchIds.get(root) ?? 0) + 1
    searchIds.set(root, id)
    return searchWorkspace(root, query, () => searchIds.get(root) !== id)
  })
  ipcMain.handle('files:read', (_e, root: string, path: string) => readText(root, path))
  ipcMain.handle('files:write', (_e, root: string, path: string, content: string) =>
    writeText(root, path, content)
  )
  ipcMain.handle('files:writeIfUnchanged', (_e, root: string, path: string, expected: string | null, content: string) =>
    writeTextIfUnchanged(root, path, expected, String(content))
  )
  ipcMain.on('files:watch', (_e, root: string) => fileWatchers.watch(root))
  ipcMain.on('files:unwatch', (_e, root: string) => fileWatchers.unwatch(root))

  ipcMain.handle('git:status', (_e, root: string) => gitStatus(root))
  ipcMain.handle('git:log', (_e, root: string) => gitLog(root))
  ipcMain.handle('git:commitFiles', (_e, root: string, hash: string) => gitCommitFiles(root, hash))
  ipcMain.handle('git:commitDiff', (_e, root: string, hash: string, path: string, from?: string) =>
    gitCommitDiff(root, hash, path, from)
  )
  ipcMain.handle('git:diff', (_e, root: string, path: string, from?: string) => gitDiff(root, path, from))
  ipcMain.handle('git:commit', (_e, root: string, message: string, paths?: string[]) =>
    gitCommit(root, message, Array.isArray(paths) ? paths.map(String) : undefined)
  )
  ipcMain.handle('git:numstat', (_e, root: string) => gitNumstat(root))
  ipcMain.handle('git:discard', (_e, root: string, change: FileChange) => gitDiscard(root, change))
  ipcMain.handle('git:push', (_e, root: string) => gitPush(root))

  ipcMain.handle('worktrees:add', (_e, root: string, label: string) => addWorktree(root, label))
  ipcMain.handle('worktrees:inspect', (_e, root: string, wt: AgentWorktree) => inspectWorktree(root, wt))
  ipcMain.handle('worktrees:remove', (_e, root: string, wt: AgentWorktree, force: boolean) =>
    removeWorktree(root, wt, force === true)
  )
  ipcMain.handle('worktrees:merge', (_e, root: string, wt: AgentWorktree) => mergeWorktree(root, wt))
  ipcMain.handle('worktrees:openPr', (_e, root: string, wt: AgentWorktree) => openWorktreePr(root, wt))

  ipcMain.on('attention:notify', (_e, notice: AttentionNotice) => notify(notice))
  ipcMain.on('attention:badge', (_e, count: unknown) => setBadge(count))
  ipcMain.on('attention:working', (_e, count: unknown) => {
    workingCount = Number.isInteger(count) && (count as number) > 0 ? (count as number) : 0
  })

  ipcMain.handle('pty:spawn', (_e, req: SpawnRequest) => ptys.spawn(req))
  ipcMain.handle('pty:kill', (_e, id: string) => ptys.kill(id))
  ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) =>
    ptys.resize(id, cols, rows)
  )
}

app.whenReady().then(() => {
  // Packaged builds get the icon from the bundle; in dev, swap out Electron's default.
  if (!app.isPackaged && process.platform === 'darwin') {
    app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  }
  if (invisible) app.dock?.hide()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (e) => {
  quitting = true
  const confirmed = confirmStop()
  quitting = false
  if (!confirmed) {
    e.preventDefault()
    return
  }
  ptys.killAll()
  fileWatchers.closeAll()
})

app.on('window-all-closed', () => {
  // Agents belong to the window; don't leave them running headless.
  ptys.killAll()
  if (process.platform !== 'darwin') app.quit()
})
