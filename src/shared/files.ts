export interface FileEntry {
  name: string
  /** Relative to the workspace root, `/`-separated. */
  path: string
  dir: boolean
}

export type ReadResult = { content: string } | { error: string }

/** Never listed or watched: noise that nobody edits by hand. */
const HIDDEN = new Set(['.git', '.DS_Store'])
const UNWATCHED = new Set(['.git', 'node_modules'])

export const isHidden = (name: string) => HIDDEN.has(name)

/** Whether a change at this relative path is worth telling the renderer about. */
export const isWatched = (path: string) => !path.split(/[\\/]/).some((part) => UNWATCHED.has(part))

/** Directories first, then case-insensitive by name. */
export function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) =>
    a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.dir ? -1 : 1
  )
}

export const parentDir = (path: string) => path.split('/').slice(0, -1).join('/')
