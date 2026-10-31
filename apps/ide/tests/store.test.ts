import { describe, expect, it } from 'vitest'
import { EMPTY_STATE, normalizeState } from '../src/shared/state'

describe('normalizeState', () => {
  it('loads state saved before worktrees existed', () => {
    const old = {
      workspaces: [{ id: 'w', name: 'app', path: '/code/app', agents: [{ id: 'a', provider: 'claude', label: 'Claude 1' }] }],
      activeWorkspaceId: 'w'
    }
    expect(normalizeState(old)).toEqual(old)
  })

  it('keeps worktree and isolation fields', () => {
    const state = {
      workspaces: [
        {
          id: 'w',
          name: 'app',
          path: '/code/app',
          isolate: true,
          agents: [{ id: 'a', provider: 'codex', label: 'Codex 1', worktree: { path: '/w/x', branch: 'squadstorm/codex-1-abcd', base: 'main' } }]
        }
      ],
      activeWorkspaceId: null
    }
    expect(normalizeState(state)).toEqual(state)
  })

  it('falls back to empty state for anything unusable', () => {
    expect(normalizeState(null)).toBe(EMPTY_STATE)
    expect(normalizeState({ workspaces: 'nope' })).toBe(EMPTY_STATE)
  })
})
