import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EMPTY_STATE, normalizeState } from '@shared/state'
import type { AppState } from '@shared/types'

const file = () => join(app.getPath('userData'), 'state.json')

export async function loadState(): Promise<AppState> {
  try {
    return normalizeState(JSON.parse(await readFile(file(), 'utf8')))
  } catch {
    return EMPTY_STATE
  }
}

export async function saveState(state: AppState): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  // Write-then-rename so a crash mid-write never leaves a truncated state file.
  const tmp = `${file()}.tmp`
  await writeFile(tmp, JSON.stringify(state, null, 2))
  await rename(tmp, file())
}
