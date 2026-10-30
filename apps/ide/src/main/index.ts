import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { join } from 'node:path'
import type { AttentionNotice, SpawnRequest } from '@shared/api'
import type { SearchQuery } from '@shared/search'
import type { AppState } from '@shared/types'
import { FileWatchers, listDir, readText, writeText } from './files'
import { gitCommit, gitCommitDiff, gitCommitFiles, gitDiff, gitLog, gitPush, gitStatus } from './git'
import { cloneRepo, githubStatus, listRepos } from './github'
import { PtyManager } from './pty'
import { allFiles, searchWorkspace } from './search'
import { migrateFromOldNames } from './migrate'
import { loadState, saveState } from './store'

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

// Held until clicked or closed: a notification that is garbage-collected stops reporting clicks.
const shownNotices = new Set<Notification>()

/** Brings the window forward and tells the renderer which agent to show. */
function showAgent(agentId: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  app.focus({ steal: true })
  mainWindow.webContents.send('attention:clicked', agentId)
}

function notify(notice: AttentionNotice): void {
  const click = () => showAgent(notice.agentId)
  if (process.env.SQUADSTORM_E2E) {
    recordedNotices.push({ ...notice, click })
    return
  }
  if (!Notification.isSupported()) return
  const shown = new Notification({ title: notice.title, body: notice.body })
  shownNotices.add(shown)
  shown.on('click', () => {
    shownNotices.delete(shown)
    click()
  })
  shown.on('close', () => shownNotices.delete(shown))
  shown.show()
}

function setBadge(count: number): void {
  const text = count > 0 ? String(count) : ''
  if (process.env.SQUADSTORM_E2E) Object.assign(globalThis, { __squadstormBadge: text })
  else app.dock?.setBadge(text)
}

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
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Links printed by agents (auth URLs, docs) open in the real browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
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
  ipcMain.on('files:watch', (_e, root: string) => fileWatchers.watch(root))
  ipcMain.on('files:unwatch', (_e, root: string) => fileWatchers.unwatch(root))

  ipcMain.handle('git:status', (_e, root: string) => gitStatus(root))
  ipcMain.handle('git:log', (_e, root: string) => gitLog(root))
  ipcMain.handle('git:commitFiles', (_e, root: string, hash: string) => gitCommitFiles(root, hash))
  ipcMain.handle('git:commitDiff', (_e, root: string, hash: string, path: string, from?: string) =>
    gitCommitDiff(root, hash, path, from)
  )
  ipcMain.handle('git:diff', (_e, root: string, path: string, from?: string) => gitDiff(root, path, from))
  ipcMain.handle('git:commit', (_e, root: string, message: string) => gitCommit(root, message))
  ipcMain.handle('git:push', (_e, root: string) => gitPush(root))

  ipcMain.on('attention:notify', (_e, notice: AttentionNotice) => notify(notice))
  ipcMain.on('attention:badge', (_e, count: number) => setBadge(count))

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
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  ptys.killAll()
  fileWatchers.closeAll()
})

app.on('window-all-closed', () => {
  // Agents belong to the window; don't leave them running headless.
  ptys.killAll()
  if (process.platform !== 'darwin') app.quit()
})
