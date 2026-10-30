import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { SquadstormApi } from '@shared/api'

function subscribe<T>(channel: string, listener: (id: string, payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, id: string, payload: T) => listener(id, payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: SquadstormApi = {
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
  files: {
    list: (root, dir) => ipcRenderer.invoke('files:list', root, dir),
    all: (root) => ipcRenderer.invoke('files:all', root),
    search: (root, query) => ipcRenderer.invoke('files:search', root, query),
    read: (root, path) => ipcRenderer.invoke('files:read', root, path),
    write: (root, path, content) => ipcRenderer.invoke('files:write', root, path, content),
    watch: (root) => ipcRenderer.send('files:watch', root),
    unwatch: (root) => ipcRenderer.send('files:unwatch', root),
    onChanged: (listener) => subscribe<string[]>('files:changed', listener)
  },
  git: {
    status: (root) => ipcRenderer.invoke('git:status', root),
    log: (root) => ipcRenderer.invoke('git:log', root),
    commitFiles: (root, hash) => ipcRenderer.invoke('git:commitFiles', root, hash),
    commitDiff: (root, hash, path, from) => ipcRenderer.invoke('git:commitDiff', root, hash, path, from),
    diff: (root, path, from) => ipcRenderer.invoke('git:diff', root, path, from),
    commit: (root, message, paths) => ipcRenderer.invoke('git:commit', root, message, paths),
    numstat: (root) => ipcRenderer.invoke('git:numstat', root),
    discard: (root, change) => ipcRenderer.invoke('git:discard', root, change),
    push: (root) => ipcRenderer.invoke('git:push', root)
  },
  worktrees: {
    add: (root, label) => ipcRenderer.invoke('worktrees:add', root, label),
    inspect: (root, worktree) => ipcRenderer.invoke('worktrees:inspect', root, worktree),
    remove: (root, worktree, force) => ipcRenderer.invoke('worktrees:remove', root, worktree, force),
    merge: (root, worktree) => ipcRenderer.invoke('worktrees:merge', root, worktree),
    openPr: (root, worktree) => ipcRenderer.invoke('worktrees:openPr', root, worktree)
  },
  attention: {
    notify: (notice) => ipcRenderer.send('attention:notify', notice),
    badge: (count) => ipcRenderer.send('attention:badge', count),
    onClicked: (listener) => {
      const handler = (_e: IpcRendererEvent, agentId: string) => listener(agentId)
      ipcRenderer.on('attention:clicked', handler)
      return () => ipcRenderer.removeListener('attention:clicked', handler)
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
