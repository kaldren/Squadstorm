import type { FileEntry, ReadResult } from './files'
import type { SearchQuery, SearchResult } from './search'
import type { Commit, DiffSides, FileChange, GitStatus, LineStats } from './git'
import type { AgentWorktree, AppState } from './types'
import type { LaunchMode, Provider } from './providers'

export interface SpawnRequest {
  id: string
  provider: Provider
  cwd: string
  cols: number
  rows: number
  /** Resume the agent's previous conversation, or start a new one. */
  mode: LaunchMode
  /** No other agent of the same CLI runs in `cwd` (Codex can only resume then). */
  soleInFolder: boolean
  /** The CLI session to start or resume. */
  sessionId: string
  /** A new session id, used if resuming fails and the agent has to start over. */
  nextSessionId: string
}

export interface SpawnResult {
  /** Output produced so far, replayed when a renderer re-attaches to a live session. */
  backlog: string
  /** Set when the process could not be started. */
  error?: string
}

export type ProviderAvailability = Record<Provider, string | null>

export interface GithubStatus {
  /** Whether the `gh` CLI is on PATH. */
  installed: boolean
  /** Signed-in gh login, or null when gh is missing or logged out. */
  user: string | null
}

export interface GithubRepo {
  fullName: string
  description: string | null
  private: boolean
  updatedAt: string
}

export interface CloneResult {
  path: string
  /** True when an earlier clone was reused instead of cloning again. */
  reused: boolean
}

/** What removing an agent's worktree would lose. */
export interface WorktreeState {
  exists: boolean
  /** Uncommitted changes in the worktree. */
  changes: number
  /** Commits on its branch that the base lacks; null when the base is gone. */
  ahead: number | null
}

/** A macOS notification for an agent that needs you. */
export interface AttentionNotice {
  agentId: string
  title: string
  body: string
}

export interface SquadstormApi {
  state: {
    load(): Promise<AppState>
    save(state: AppState): Promise<void>
  }
  pickFolder(): Promise<string | null>
  /** Absolute path of a file dropped from Finder ('' for files that aren't on disk). */
  pathForFile(file: File): string
  /** Absolute path of each provider's CLI, or null when it is not on PATH. */
  providers(): Promise<ProviderAvailability>
  github: {
    status(): Promise<GithubStatus>
    repos(): Promise<GithubRepo[]>
    /** Accepts `owner/name` or a GitHub URL; resolves to the local clone. */
    clone(repo: string): Promise<CloneResult>
    onCloneProgress(listener: (line: string) => void): () => void
  }
  /** Paths are relative to the workspace root and `/`-separated. */
  files: {
    list(root: string, dir: string): Promise<FileEntry[]>
    /** Every file in the workspace, honoring .gitignore when it is a git repo. */
    all(root: string): Promise<string[]>
    /** Searches file contents. A newer search of the same root cuts an older one short. */
    search(root: string, query: SearchQuery): Promise<SearchResult>
    read(root: string, path: string): Promise<ReadResult>
    write(root: string, path: string, content: string): Promise<void>
    /** Writes only if the file still holds `expected` (null: absent); rejects otherwise. */
    writeIfUnchanged(root: string, path: string, expected: string | null, content: string): Promise<void>
    watch(root: string): void
    unwatch(root: string): void
    onChanged(listener: (root: string, paths: string[]) => void): () => void
  }
  git: {
    status(root: string): Promise<GitStatus>
    /** Recent commits on the current branch, newest first. */
    log(root: string): Promise<Commit[]>
    /** Files a commit changed, compared with its first parent. */
    commitFiles(root: string, hash: string): Promise<FileChange[]>
    /** A file before and after a commit. */
    commitDiff(root: string, hash: string, path: string, from?: string): Promise<DiffSides>
    /** `from` is the old path of a renamed file. */
    diff(root: string, path: string, from?: string): Promise<DiffSides>
    /** Stages everything and commits it, or only `paths` when given. */
    commit(root: string, message: string, paths?: string[]): Promise<void>
    /** Lines added and removed per changed file. */
    numstat(root: string): Promise<Record<string, LineStats>>
    /** Throws away a file's uncommitted change (new files go to the Trash). */
    discard(root: string, change: FileChange): Promise<void>
    /** Pushes the current branch, publishing it to origin if it has no upstream yet. */
    push(root: string): Promise<void>
  }
  /** Agent worktrees; `root` is always the workspace folder. */
  worktrees: {
    add(root: string, label: string): Promise<AgentWorktree>
    inspect(root: string, worktree: AgentWorktree): Promise<WorktreeState>
    /** `force` discards uncommitted changes. */
    remove(root: string, worktree: AgentWorktree, force: boolean): Promise<{ branchKept: boolean }>
    merge(root: string, worktree: AgentWorktree): Promise<{ commits: number }>
    /** Resolves to the PR's URL. */
    openPr(root: string, worktree: AgentWorktree): Promise<string>
  }
  attention: {
    /** Shows a macOS notification; clicking it brings the window forward and reports `onClicked`. */
    notify(notice: AttentionNotice): void
    /** How many agents are waiting, shown on the dock icon (0 clears it). */
    badge(count: number): void
    onClicked(listener: (agentId: string) => void): () => void
    /** How many agents are working: quitting while some are asks first. */
    working(count: number): void
  }
  pty: {
    spawn(req: SpawnRequest): Promise<SpawnResult>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): Promise<void>
    onData(listener: (id: string, data: string) => void): () => void
    onExit(listener: (id: string, exitCode: number) => void): () => void
    /** The agent started over on a new session (its old one couldn't be resumed). */
    onSession(listener: (id: string, sessionId: string) => void): () => void
  }
}
