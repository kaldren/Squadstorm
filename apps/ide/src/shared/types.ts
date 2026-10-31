import type { Provider } from './providers'

/** An agent's own git worktree, on its own branch. */
export interface AgentWorktree {
  /** Absolute path of the worktree folder. */
  path: string
  branch: string
  /** The workspace branch it was created from, and merges back into. */
  base: string
}

export interface AgentConfig {
  id: string
  provider: Provider
  label: string
  /** Set when the agent works in its own worktree instead of the workspace folder. */
  worktree?: AgentWorktree
  /** It has run before, so the next launch resumes its conversation. */
  started?: boolean
  /** The CLI session it resumes, when not its own id (after its first session couldn't be resumed). */
  sessionId?: string
  /** Another agent of the same CLI worked in its folder at some point, so "the newest session there" may not be its own. */
  sharedFolder?: boolean
}

export interface Workspace {
  id: string
  name: string
  path: string
  /** `owner/name` when the workspace is a clone of a GitHub repo. */
  repo?: string
  /** New agents get their own worktree. */
  isolate?: boolean
  agents: AgentConfig[]
}

export interface AppState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
}
