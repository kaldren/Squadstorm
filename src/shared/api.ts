import type { FileEntry, ReadResult } from './files'
import type { SearchQuery, SearchResult } from './search'
import type { Commit, DiffSides, FileChange, GitStatus } from './git'
import type { AppState } from './types'
import type { Provider } from './providers'

export interface SpawnRequest {
  id: string
  provider: Provider
  cwd: string
  cols: number
  rows: number
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

export interface SquadstormApi {
  state: {
    load(): Promise<AppState>
    save(state: AppState): Promise<void>
  }
  pickFolder(): Promise<string | null>
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
    /** Stages everything and commits it. */
    commit(root: string, message: string): Promise<void>
    /** Pushes the current branch, publishing it to origin if it has no upstream yet. */
    push(root: string): Promise<void>
  }
  pty: {
    spawn(req: SpawnRequest): Promise<SpawnResult>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): Promise<void>
    onData(listener: (id: string, data: string) => void): () => void
    onExit(listener: (id: string, exitCode: number) => void): () => void
  }
}
