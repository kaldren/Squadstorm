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

/** Never listed when searching, even outside a git repo. */
const UNSEARCHED = new Set(['.git', 'node_modules'])
export const isSearched = (name: string) => !UNSEARCHED.has(name)

export interface FileMatch {
  path: string
  /** Indices into `path` of the matched query characters, for highlighting. */
  positions: number[]
  score: number
}

const isBoundary = (path: string, i: number) =>
  i === 0 || '/_-. '.includes(path[i - 1]) || (path[i] !== path[i].toLowerCase() && path[i - 1] === path[i - 1].toLowerCase())

/**
 * Fuzzy-matches a query against a path: every query character must appear in order,
 * ignoring case and spaces. Matches are taken as far right as possible so they land in
 * the file name, and score higher when contiguous, on word boundaries, or in the name.
 */
export function fuzzyMatch(query: string, path: string): FileMatch | null {
  const q = query.replace(/\s+/g, '').toLowerCase()
  const lower = path.toLowerCase()
  const nameStart = path.lastIndexOf('/') + 1
  let positions: number[] = []

  const substring = lower.lastIndexOf(q)
  if (substring !== -1) positions = Array.from(q, (_, k) => substring + k)
  else {
    let i = lower.length - 1
    for (let k = q.length - 1; k >= 0; k--) {
      while (i >= 0 && lower[i] !== q[k]) i--
      if (i < 0) return null
      positions.unshift(i--)
    }
  }

  let score = 0
  positions.forEach((p, k) => {
    score += 1
    if (k > 0 && positions[k - 1] === p - 1) score += 5
    if (isBoundary(path, p)) score += 8
    if (p >= nameStart) score += 3
  })
  if (q.length > 0 && lower.slice(nameStart).startsWith(q)) score += 20
  // Shorter paths win ties: `src/a.ts` before `test/fixtures/deep/a.ts`.
  return { path, positions, score: score - path.length * 0.05 }
}

/** Best matches first. An empty query keeps the original order. */
export function searchFiles(query: string, paths: string[], limit = 50): FileMatch[] {
  if (!query.trim()) return paths.slice(0, limit).map((path) => ({ path, positions: [], score: 0 }))
  const matches: FileMatch[] = []
  for (const path of paths) {
    const m = fuzzyMatch(query, path)
    if (m) matches.push(m)
  }
  return matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit)
}
