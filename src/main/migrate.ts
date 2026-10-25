import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import type { AppState } from '@shared/types'

/**
 * The app was called Vibe IDE before. Carries its profile and cloned repos over to Leya's
 * locations, and repoints saved workspaces at the moved clones. Safe to run on every launch.
 */
export function migrateFromVibeIde(): void {
  const userData = app.getPath('userData')
  const oldUserData = join(dirname(userData), 'vibe-ide')
  if (!existsSync(userData) && existsSync(oldUserData)) renameSync(oldUserData, userData)

  const oldRoot = join(homedir(), 'VibeIDE')
  const oldRepos = join(oldRoot, 'repos')
  const newRepos = join(homedir(), 'Leya', 'repos')
  if (existsSync(oldRepos) && !existsSync(newRepos)) {
    mkdirSync(dirname(newRepos), { recursive: true })
    renameSync(oldRepos, newRepos)
    if (readdirSync(oldRoot).length === 0) rmdirSync(oldRoot)
  }
  if (!existsSync(newRepos)) return

  const stateFile = join(userData, 'state.json')
  if (!existsSync(stateFile)) return
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as AppState
  let changed = false
  for (const ws of state.workspaces ?? []) {
    if (ws.path === oldRepos || ws.path.startsWith(oldRepos + sep)) {
      ws.path = newRepos + ws.path.slice(oldRepos.length)
      changed = true
    }
  }
  if (changed) writeFileSync(stateFile, JSON.stringify(state, null, 2))
}
