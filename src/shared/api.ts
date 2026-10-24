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

export interface VibeApi {
  state: {
    load(): Promise<AppState>
    save(state: AppState): Promise<void>
  }
  pickFolder(): Promise<string | null>
  ensureSpecsDir(projectPath: string): Promise<void>
  /** Absolute path of each provider's CLI, or null when it is not on PATH. */
  providers(): Promise<ProviderAvailability>
  pty: {
    spawn(req: SpawnRequest): Promise<SpawnResult>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): Promise<void>
    onData(listener: (id: string, data: string) => void): () => void
    onExit(listener: (id: string, exitCode: number) => void): () => void
  }
}
