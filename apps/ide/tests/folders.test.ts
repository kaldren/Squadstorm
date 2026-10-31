import { describe, expect, it } from 'vitest'
import { soleInFolder } from '../src/shared/sessions'
import type { AgentConfig, Workspace } from '../src/shared/types'

const agent = (id: string, provider: AgentConfig['provider'], extra: Partial<AgentConfig> = {}): AgentConfig => ({ id, provider, label: id, ...extra })
const workspace = (id: string, path: string, agents: AgentConfig[]): Workspace => ({ id, name: id, path, agents })

describe('soleInFolder', () => {
  it('is true for the only agent of its CLI in its folder', () => {
    const a = agent('a', 'codex')
    expect(soleInFolder(a, [workspace('w', '/repo', [a, agent('c', 'claude')])])).toBe(true)
  })

  it('is false while another agent of the same CLI shares the folder', () => {
    const a = agent('a', 'codex')
    expect(soleInFolder(a, [workspace('w', '/repo', [a, agent('b', 'codex')])])).toBe(false)
  })

  it('counts agents in other workspaces on the same folder', () => {
    const a = agent('a', 'codex')
    expect(soleInFolder(a, [workspace('w1', '/repo', [a]), workspace('w2', '/repo', [agent('b', 'codex')])])).toBe(false)
  })

  it('stays false once the folder was shared, even after the other agent is gone', () => {
    const a = agent('a', 'codex', { sharedFolder: true })
    expect(soleInFolder(a, [workspace('w', '/repo', [a])])).toBe(false)
  })

  it('treats an agent in its own worktree as alone', () => {
    const a = agent('a', 'codex', { worktree: { path: '/wt/a', branch: 'squadstorm/codex-1-aaaa', base: 'main' } })
    expect(soleInFolder(a, [workspace('w', '/repo', [a, agent('b', 'codex')])])).toBe(true)
  })
})
