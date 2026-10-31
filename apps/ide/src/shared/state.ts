import type { AppState } from './types'

export const EMPTY_STATE: AppState = { workspaces: [], activeWorkspaceId: null }

/** Saved state as read from disk; anything unusable becomes the empty state. Unknown fields pass through. */
export function normalizeState(parsed: unknown): AppState {
  const state = parsed as Partial<AppState> | null
  if (!state || !Array.isArray(state.workspaces)) return EMPTY_STATE
  return { workspaces: state.workspaces, activeWorkspaceId: state.activeWorkspaceId ?? null }
}
