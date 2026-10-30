import type { AgentWorktree } from './types'

/** Lowercase letters, digits and dashes: safe in branch names and folder names. */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  )
}

/** `squadstorm/claude-2-9f3a`: the agent's label plus a suffix that keeps re-used labels apart. */
export function branchName(label: string, suffix: string): string {
  return `squadstorm/${slug(label)}-${suffix}`
}

/** FNV-1a, as 6 hex characters: tells apart repos with the same folder name. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0').slice(0, 6)
}

/** `<base>/<repo>-<hash>/<branch without squadstorm/>`, outside the repo so its tooling never sees it. */
export function worktreeDir(base: string, workspacePath: string, branch: string): string {
  const repo = workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? 'repo'
  return `${base.replace(/\/+$/, '')}/${slug(repo)}-${shortHash(workspacePath)}/${branch.replace(/^squadstorm\//, '')}`
}

export interface WorktreeEntry {
  path: string
  /** Short branch name, or null for a detached HEAD. */
  branch: string | null
}

/** Parses `git worktree list --porcelain`. */
export function parseWorktreeList(out: string): WorktreeEntry[] {
  return out
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split('\n')
      const path = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length)
      const ref = lines.find((l) => l.startsWith('branch '))?.slice('branch '.length)
      return path ? { path, branch: ref ? ref.replace(/^refs\/heads\//, '') : null } : null
    })
    .filter((e): e is WorktreeEntry => e !== null)
}

/** The git and gh arguments that publish an agent's branch and open a PR for it. */
export function prCommands(wt: AgentWorktree): { push: string[]; pr: string[] } {
  return {
    push: ['push', '-u', 'origin', wt.branch],
    pr: ['pr', 'create', '--head', wt.branch, '--base', wt.base, '--fill']
  }
}
