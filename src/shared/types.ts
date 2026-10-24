import type { Provider } from './providers'

export type Mode = 'vibe' | 'spec'

export interface AgentConfig {
  id: string
  provider: Provider
  label: string
}

export interface Workspace {
  id: string
  name: string
  path: string
  mode: Mode
  agents: AgentConfig[]
}

export interface AppState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
}
