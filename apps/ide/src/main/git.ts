import { readFile } from 'node:fs/promises'
import { LOG_FORMAT, NOT_A_REPO, parseLog, parseNameStatus, parseStatus, type Commit, type FileChange, type DiffSides, type GitStatus } from '@shared/git'
import { resolveInside } from './files'
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

/** Commits every change in the working tree, like `git commit -am` plus new files. */
export async function gitCommit(root: string, message: string): Promise<void> {
  if (!message.trim()) throw new Error('Write a commit message first.')
  await git(root, ['add', '-A'])
  await git(root, ['commit', '-m', message])
}

export async function gitPush(root: string): Promise<void> {
  const { upstream } = await gitStatus(root)
  // First push of a new branch: publish it and track it.
  await git(root, upstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'])
}
