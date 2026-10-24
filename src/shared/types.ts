import type { Provider } from './providers'

export interface AgentConfig {
  id: string
  provider: Provider
  label: string
}

export interface Workspace {
  id: string
  name: string
  path: string
  /** `owner/name` when the workspace is a clone of a GitHub repo. */
  repo?: string
  agents: AgentConfig[]
}

export interface AppState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
}
