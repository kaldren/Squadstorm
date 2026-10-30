import { readFile, rm } from 'node:fs/promises'
import { shell } from 'electron'
import { LOG_FORMAT, NOT_A_REPO, parseLog, parseNameStatus, parseNumstat, parseStatus, type Commit, type FileChange, type DiffSides, type GitStatus, type LineStats } from '@shared/git'
import { readText, resolveInside } from './files'
import { gitEnv, run } from './github'
import { resolveCommand } from './shell-env'

export async function git(root: string, args: string[]): Promise<string> {
  const env = await gitEnv()
  const file = resolveCommand('git', env.PATH ?? '') ?? 'git'
  return run(file, args, env, root)
}

export async function gitStatus(root: string): Promise<GitStatus> {
  try {
    const [out, remotes] = await Promise.all([
      git(root, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all']),
      git(root, ['remote'])
    ])
    return { ...parseStatus(out), remote: remotes.trim().length > 0 }
  } catch {
    return NOT_A_REPO
  }
}

/** Tracked and untracked files, minus anything .gitignore excludes. Throws outside a repo. */
export async function gitFiles(root: string): Promise<string[]> {
  const out = await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  // Tracked files deleted from disk would open as an error, so leave them out.
  const deleted = new Set((await git(root, ['ls-files', '-z', '--deleted'])).split('\0'))
  return [...new Set(out.split('\0'))].filter((p) => p && !deleted.has(p))
}

/** Most recent commits on HEAD, newest first. Empty for repos without commits yet. */
export async function gitLog(root: string, limit = 200): Promise<Commit[]> {
  const out = await git(root, ['log', '-z', `--max-count=${limit}`, `--format=${LOG_FORMAT}`]).catch(() => '')
  return parseLog(out)
}

// What a root commit is compared against.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** The commit a commit's changes are shown against: its first parent, or nothing for a root commit. */
async function parentOf(root: string, hash: string): Promise<string> {
  const [, parent] = (await git(root, ['rev-list', '--parents', '-n', '1', hash])).trim().split(' ')
  return parent ?? EMPTY_TREE
}

/** Files a commit changed, compared with its first parent. */
export async function gitCommitFiles(root: string, hash: string): Promise<FileChange[]> {
  const base = await parentOf(root, hash)
  return parseNameStatus(await git(root, ['diff', '--name-status', '-z', '-M', base, hash]))
}

/** A file before and after a commit. `from` is its old path if the commit renamed it. */
export async function gitCommitDiff(root: string, hash: string, path: string, from?: string): Promise<DiffSides> {
  const base = await parentOf(root, hash)
  const [original, modified] = await Promise.all([
    git(root, ['show', `${base}:${from ?? path}`]).catch(() => ''),
    git(root, ['show', `${hash}:${path}`]).catch(() => '')
  ])
  return { original, modified }
}

export async function gitDiff(root: string, path: string, from?: string): Promise<DiffSides> {
  const [original, modified] = await Promise.all([
    git(root, ['show', `HEAD:${from ?? path}`]).catch(() => ''),
    readFile(resolveInside(root, path), 'utf8').catch(() => '')
  ])
  return { original, modified }
}

/**
 * Commits every change in the working tree, like `git commit -am` plus new files; or, given `paths`,
 * only those (other changes stay uncommitted, staged or not).
 */
export async function gitCommit(root: string, message: string, paths?: string[]): Promise<void> {
  if (!message.trim()) throw new Error('Write a commit message first.')
  if (paths) {
    if (paths.length === 0) throw new Error('Pick at least one file to commit.')
    paths.forEach((p) => resolveInside(root, p))
    await git(root, ['add', '-A', '--', ...paths])
    await git(root, ['commit', '-m', message, '--', ...paths])
    return
  }
  await git(root, ['add', '-A'])
  await git(root, ['commit', '-m', message])
}

/** Lines added and removed per changed file, untracked files included; null counts for binary files. */
export async function gitNumstat(root: string): Promise<Record<string, LineStats>> {
  const hasHead = await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(
    () => true,
    () => false
  )
  const stats = parseNumstat(await git(root, ['diff', '--numstat', '-z', hasHead ? 'HEAD' : EMPTY_TREE]))
  // Untracked files aren't in the diff: every line is added.
  for (const change of (await gitStatus(root)).changes) {
    if (change.path in stats || change.kind !== 'A') continue
    const read = await readText(root, change.path).catch(() => ({ error: 'unreadable' }))
    stats[change.path] =
      'error' in read ? { added: null, removed: null } : { added: read.content.split('\n').length - (read.content.endsWith('\n') ? 1 : 0), removed: 0 }
  }
  return stats
}

/** Moves a file to the Trash (e2e tests record it and delete it instead). */
async function trash(root: string, path: string): Promise<void> {
  const full = resolveInside(root, path)
  if (process.env.SQUADSTORM_E2E) {
    ;((globalThis as any).__squadstormTrashed ??= []).push(full)
    await rm(full, { force: true })
  } else {
    await shell.trashItem(full)
  }
}

/**
 * Throws away a file's uncommitted change: tracked files go back to HEAD, new files go to the Trash,
 * a rename is undone.
 */
export async function gitDiscard(root: string, change: FileChange): Promise<void> {
  resolveInside(root, change.path)
  if (change.kind === 'C') throw new Error(`${change.path} has a merge conflict. Resolve it first.`)
  const restore = (path: string) => git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', path])
  const unstage = (path: string) => git(root, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', path])
  if (change.kind === 'M' || change.kind === 'D') return void (await restore(change.path))
  if (change.kind === 'R' && change.from) {
    resolveInside(root, change.from)
    await restore(change.from)
  }
  await unstage(change.path)
  await trash(root, change.path)
}

export async function gitPush(root: string): Promise<void> {
  const { upstream } = await gitStatus(root)
  // First push of a new branch: publish it and track it.
  await git(root, upstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'])
}
