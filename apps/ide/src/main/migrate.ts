import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import type { AppState } from '@shared/types'

// Earlier names of the app, newest first: its profile folder and the folder under ~ holding repos/.
const OLD_NAMES = [
  { userData: 'leya', root: 'Leya' },
  { userData: 'vibe-ide', root: 'VibeIDE' }
]

/**
 * The app was called Leya, and Vibe IDE before that. Carries the newest old profile and cloned
 * repos over to Squadstorm IDE's locations, and repoints saved workspaces at the moved clones.
 * Safe to run on every launch.
 */
export function migrateFromOldNames(): void {
  const userData = app.getPath('userData')
  const oldUserData = OLD_NAMES.map((n) => join(dirname(userData), n.userData)).find(existsSync)
  if (!existsSync(userData) && oldUserData) renameSync(oldUserData, userData)

  const newRepos = join(homedir(), 'SquadstormIDE', 'repos')
  for (const { root } of OLD_NAMES) {
    const oldRoot = join(homedir(), root)
    const oldRepos = join(oldRoot, 'repos')
    if (existsSync(oldRepos) && !existsSync(newRepos)) {
      mkdirSync(dirname(newRepos), { recursive: true })
      renameSync(oldRepos, newRepos)
      if (readdirSync(oldRoot).length === 0) rmdirSync(oldRoot)
    }
  }
  if (!existsSync(newRepos)) return

  const stateFile = join(userData, 'state.json')
  if (!existsSync(stateFile)) return
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as AppState
  let changed = false
  for (const ws of state.workspaces ?? []) {
    for (const { root } of OLD_NAMES) {
      const oldRepos = join(homedir(), root, 'repos')
      if (ws.path === oldRepos || ws.path.startsWith(oldRepos + sep)) {
        ws.path = newRepos + ws.path.slice(oldRepos.length)
        changed = true
      }
    }
  }
  if (changed) writeFileSync(stateFile, JSON.stringify(state, null, 2))
}
