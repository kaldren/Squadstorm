import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { VibeApi } from '@shared/api'

function subscribe<T>(channel: string, listener: (id: string, payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, id: string, payload: T) => listener(id, payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: VibeApi = {
  state: {
    load: () => ipcRenderer.invoke('state:load'),
    save: (state) => ipcRenderer.invoke('state:save', state)
  },
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  ensureSpecsDir: (projectPath) => ipcRenderer.invoke('fs:ensureSpecsDir', projectPath),
  providers: () => ipcRenderer.invoke('providers:list'),
  pty: {
    spawn: (req) => ipcRenderer.invoke('pty:spawn', req),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('pty:kill', id),
    onData: (listener) => subscribe<string>('pty:data', listener),
    onExit: (listener) => subscribe<number>('pty:exit', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
