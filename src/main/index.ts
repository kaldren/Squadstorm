import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { SpawnRequest } from '@shared/api'
import type { AppState } from '@shared/types'
import { cloneRepo, githubStatus, listRepos } from './github'
import { PtyManager } from './pty'
import { loadState, saveState } from './store'

// Lets tests run against a throwaway profile.
if (process.env.VIBE_USER_DATA) app.setPath('userData', process.env.VIBE_USER_DATA)

let mainWindow: BrowserWindow | null = null

const ptys = new PtyManager((channel, id, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, id, payload)
})

// Terminal text is drawn on a WebGL canvas, so e2e tests read pty output from here instead.
if (process.env.VIBE_E2E) Object.assign(globalThis, { __vibePtys: ptys })

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

  ipcMain.handle('pty:spawn', (_e, req: SpawnRequest) => ptys.spawn(req))
  ipcMain.handle('pty:kill', (_e, id: string) => ptys.kill(id))
  ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) =>
    ptys.resize(id, cols, rows)
  )
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => ptys.killAll())

app.on('window-all-closed', () => {
  // Agents belong to the window; don't leave them running headless.
  ptys.killAll()
  if (process.platform !== 'darwin') app.quit()
})
