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
  providers: () => ipcRenderer.invoke('providers:list'),
  github: {
    status: () => ipcRenderer.invoke('github:status'),
    repos: () => ipcRenderer.invoke('github:repos'),
    clone: (repo) => ipcRenderer.invoke('github:clone', repo),
    onCloneProgress: (listener) => {
      const handler = (_e: IpcRendererEvent, line: string) => listener(line)
      ipcRenderer.on('github:cloneProgress', handler)
      return () => ipcRenderer.removeListener('github:cloneProgress', handler)
    }
  },
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
