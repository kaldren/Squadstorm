/** Simplified change kind, as shown next to a file: Modified, Added, Deleted, Renamed, Conflict. */
export type ChangeKind = 'M' | 'A' | 'D' | 'R' | 'C'

export interface FileChange {
  /** Relative to the repo root, `/`-separated. */
  path: string
  kind: ChangeKind
  /** Previous path of a rename. */
  from?: string
}

export interface GitStatus {
  /** False when the folder is not a git repository (or git is missing). */
  repo: boolean
  branch: string | null
  /** Whether the branch tracks a remote branch. */
  upstream: boolean
  /** Whether the repo has any remote to push to. */
  remote: boolean
  ahead: number
  behind: number
  changes: FileChange[]
}

export interface DiffSides {
  /** Content at HEAD ('' for new files). */
  original: string
  /** Content on disk ('' for deleted files). */
  modified: string
}

export const NOT_A_REPO: GitStatus = {
  repo: false,
  branch: null,
  upstream: false,
  remote: false,
  ahead: 0,
  behind: 0,
  changes: []
}

function kindOf(xy: string): ChangeKind {
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'C'
  if (xy === '??' || xy.includes('A')) return 'A'
  if (xy.includes('D')) return 'D'
  if (xy.includes('R')) return 'R'
  return 'M'
}

/** Parses `git status --porcelain=v1 -b -z`. `remote` is filled in by the caller. */
export function parseStatus(out: string): GitStatus {
  const records = out.split('\0')
  const status: GitStatus = { ...NOT_A_REPO, repo: true, changes: [] }
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (record.startsWith('## ')) {
      const header = record.slice(3)
      // `main...origin/main [ahead 1]`, `main`, or `No commits yet on main`. Branch names can't contain `..`.
      const branch = header
        .replace(/^(No commits yet on|Initial commit on) /, '')
        .split('...')[0]
        .split(' ')[0]
      status.branch = header.startsWith('HEAD (no branch)') ? null : branch
      status.upstream = header.includes('...')
      status.ahead = Number(header.match(/ahead (\d+)/)?.[1] ?? 0)
      status.behind = Number(header.match(/behind (\d+)/)?.[1] ?? 0)
      continue
    }
    if (record.length < 4) continue
    const xy = record.slice(0, 2)
    const change: FileChange = { path: record.slice(3), kind: kindOf(xy) }
    // With -z a rename's original path follows as its own record.
    if (xy.includes('R') || xy.includes('C')) change.from = records[++i]
    status.changes.push(change)
  }
  return status
}

export interface Commit {
  hash: string
  shortHash: string
  author: string
  /** Unix time in milliseconds. */
  date: number
  /** Branch and tag names pointing at the commit, e.g. `HEAD -> main`, `origin/main`, `tag: v1`. */
  refs: string[]
  subject: string
}

/** `git log` format read by `parseLog`: fields split by \x1f, commits by NUL (with -z). */
export const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%at%x1f%D%x1f%s'

export function parseLog(out: string): Commit[] {
  return out
    .split('\0')
    .map((record) => record.replace(/^\n/, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, author, at, refs, subject] = record.split('\x1f')
      return {
        hash,
        shortHash,
        author,
        date: Number(at) * 1000,
        refs: refs ? refs.split(', ') : [],
        subject: subject ?? ''
      }
    })
}

/** Parses `git diff --name-status -z`: `M\0path\0`, or `R100\0old\0new\0` for renames and copies. */
export function parseNameStatus(out: string): FileChange[] {
  const fields = out.split('\0')
  const changes: FileChange[] = []
  for (let i = 0; i + 1 < fields.length; ) {
    const code = fields[i++]
    if (!code) continue
    if (code[0] === 'R' || code[0] === 'C') {
      const from = fields[i++]
      changes.push({ path: fields[i++], kind: code[0] === 'R' ? 'R' : 'A', from })
    } else {
      changes.push({ path: fields[i++], kind: kindOf(code[0]) })
    }
  }
  return changes
}
