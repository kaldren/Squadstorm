import type { FileEntry, ReadResult } from './files'
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

export interface VibeApi {
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
    read(root: string, path: string): Promise<ReadResult>
    write(root: string, path: string, content: string): Promise<void>
    watch(root: string): void
    unwatch(root: string): void
    onChanged(listener: (root: string, paths: string[]) => void): () => void
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
