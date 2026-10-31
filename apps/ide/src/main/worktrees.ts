import { randomBytes } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { shell } from 'electron'
import type { WorktreeState } from '@shared/api'
import type { AgentWorktree } from '@shared/types'
import { branchName, nameError, namedBranch, prCommands, worktreeDir } from '@shared/worktrees'
import { git, gitStatus } from './git'
import { gitEnv, run } from './github'
import { resolveCommand } from './shell-env'

// SQUADSTORM_WORKTREES_DIR moves agent worktrees (e2e tests point it at a temp folder).
const baseDir = () => process.env.SQUADSTORM_WORKTREES_DIR ?? join(homedir(), 'SquadstormIDE', 'worktrees')

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false
  )

/**
 * Worktree records come from the renderer: only act on Squadstorm's own branches inside its worktrees
 * folder, so a bad record can never remove or merge something else.
 */
function checked(wt: AgentWorktree): AgentWorktree {
  const rel = relative(resolve(baseDir()), resolve(String(wt?.path)))
  const inside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  if (!inside || !/^squadstorm\/[a-z0-9-]+$/.test(String(wt?.branch)) || !/^[^-\s][^\s]*$/.test(String(wt?.base))) {
    throw new Error('Not a Squadstorm worktree.')
  }
  return wt
}

/** Commits on the agent's branch that its base doesn't have; null when that can't be told (base gone). */
async function aheadOfBase(root: string, wt: AgentWorktree): Promise<number | null> {
  try {
    return Number((await git(root, ['rev-list', '--count', `${wt.base}..${wt.branch}`])).trim())
  } catch {
    return null
  }
}

const hasCommits = (root: string) =>
  git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(
    () => true,
    () => false
  )

/**
 * Why `branch` can't be a new agent's branch in this workspace, or null when it's free. Taken means a
 * local branch of that name or nested under it (git can't have both), or the same branch on a remote:
 * reusing a name pushed for a PR would push new work into that old PR.
 */
async function nameTaken(root: string, branch: string): Promise<string | null> {
  const refs = await git(root, ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`, `refs/remotes/*/${branch}`]).catch(
    () => ''
  )
  if (refs.trim()) return `A branch named ${branch} already exists. Pick another name.`
  const path = worktreeDir(baseDir(), root, branch)
  if (await exists(path)) return `A folder for ${branch} already exists at ${path}.`
  return null
}

/** Why the typed branch name can't be used, or null when it can; a blank name is always fine (automatic). */
export async function checkName(root: string, name: string): Promise<string | null> {
  const text = String(name ?? '')
  if (!text.trim()) return null
  return nameError(text) ?? (await nameTaken(root, namedBranch(text)))
}

/**
 * A new worktree on a new branch, from the workspace's current branch and commit. The branch is
 * `squadstorm/<name>` when a name is given, otherwise named after the agent's label.
 */
export async function addWorktree(root: string, label: string, name?: string): Promise<AgentWorktree> {
  const { repo, branch: base } = await gitStatus(root)
  if (!repo) throw new Error('This folder is not a git repository.')
  if (!base) throw new Error('The workspace is on a detached HEAD. Check out a branch first.')
  if (!(await hasCommits(root))) throw new Error('The repository has no commits yet. Commit something first.')
  const typed = typeof name === 'string' && name.trim() !== ''
  if (typed) {
    const problem = await checkName(root, name)
    if (problem) throw new Error(problem)
  }
  const branch = typed ? namedBranch(name) : branchName(label, randomBytes(2).toString('hex'))
  const path = worktreeDir(baseDir(), root, branch)
  await mkdir(dirname(path), { recursive: true })
  await git(root, ['worktree', 'add', '-b', branch, path, 'HEAD'])
  return { path, branch, base }
}

/** What removing the worktree would lose. */
export async function inspectWorktree(root: string, wt: AgentWorktree): Promise<WorktreeState> {
  checked(wt)
  const present = await exists(wt.path)
  const changes = present ? (await gitStatus(wt.path)).changes.length : 0
  return { exists: present, changes, ahead: await aheadOfBase(root, wt) }
}

/**
 * Removes the worktree (`force` discards its uncommitted changes, so only after the user agreed) and
 * deletes its branch when git considers it merged. A branch with work of its own is kept.
 */
export async function removeWorktree(root: string, wt: AgentWorktree, force: boolean): Promise<{ branchKept: boolean }> {
  checked(wt)
  if (await exists(wt.path)) await git(root, ['worktree', 'remove', ...(force ? ['--force'] : []), wt.path])
  await git(root, ['worktree', 'prune']).catch(() => {})
  try {
    // -d, never -D: git refuses to delete a branch whose commits aren't merged.
    await git(root, ['branch', '-d', wt.branch])
    return { branchKept: false }
  } catch {
    const kept = await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${wt.branch}`]).then(
      () => true,
      () => false
    )
    return { branchKept: kept }
  }
}

/** Merges the agent's committed work into its base branch, in the workspace folder. */
export async function mergeWorktree(root: string, wt: AgentWorktree): Promise<{ commits: number }> {
  checked(wt)
  const workspace = await gitStatus(root)
  if (workspace.branch !== wt.base) {
    throw new Error(`The workspace is on ${workspace.branch ?? 'a detached HEAD'}. Check out ${wt.base} to merge into it.`)
  }
  const agent = await gitStatus(wt.path)
  if (agent.changes.length > 0) {
    throw new Error(`The agent has ${agent.changes.length} uncommitted change(s). Commit them in its worktree first.`)
  }
  const commits = await aheadOfBase(root, wt)
  if (commits === 0) throw new Error(`Nothing to merge: ${wt.branch} has no commits that ${wt.base} lacks.`)
  try {
    await git(root, ['merge', '--no-ff', '--no-edit', wt.branch])
  } catch (e) {
    // git reports conflicts on stdout (and in the user's language), so look for the merge it left
    // half done rather than at the message.
    const inProgress = await git(root, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']).then(
      () => true,
      () => false
    )
    if (!inProgress) throw e
    await git(root, ['merge', '--abort']).catch(() => {})
    throw new Error(`Merging would conflict with ${wt.base}. Ask the agent to merge ${wt.base} into its branch first.`)
  }
  return { commits: commits ?? 0 }
}

/** Pushes the agent's branch and opens a PR for it with gh; returns the PR URL. */
export async function openWorktreePr(root: string, wt: AgentWorktree): Promise<string> {
  checked(wt)
  const env = await gitEnv()
  const gh = resolveCommand('gh', env.PATH ?? '')
  if (!gh) throw new Error('Install the GitHub CLI (gh) and run `gh auth login` to open PRs.')
  const { push, pr } = prCommands(wt)
  await git(root, push)
  const url = (await run(gh, pr, env, wt.path)).trim().split('\n').pop() ?? ''
  if (/^https:\/\//.test(url)) void shell.openExternal(url)
  return url
}
