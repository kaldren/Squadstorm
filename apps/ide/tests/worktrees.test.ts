import { describe, expect, it } from 'vitest'
import { branchName, parseWorktreeList, prCommands, slug, worktreeDir } from '../src/shared/worktrees'

describe('branch names', () => {
  it('slugs the agent label and adds the suffix', () => {
    expect(branchName('Claude 2', '9f3a')).toBe('squadstorm/claude-2-9f3a')
    expect(branchName('  Ünïcode / agent!! ', '0001')).toBe('squadstorm/n-code-agent-0001')
  })

  it('never produces an empty slug', () => {
    expect(slug('!!!')).toBe('agent')
  })
})

describe('worktreeDir', () => {
  it('nests the branch under the repo name and a hash of its path', () => {
    const dir = worktreeDir('/home/me/SquadstormIDE/worktrees/', '/code/My App', 'squadstorm/claude-1-abcd')
    expect(dir).toMatch(/^\/home\/me\/SquadstormIDE\/worktrees\/my-app-[0-9a-f]{6}\/claude-1-abcd$/)
  })

  it('keeps repos with the same folder name apart', () => {
    const a = worktreeDir('/w', '/one/app', 'squadstorm/x-1')
    const b = worktreeDir('/w', '/two/app', 'squadstorm/x-1')
    expect(a).not.toBe(b)
    expect(worktreeDir('/w', '/one/app', 'squadstorm/x-1')).toBe(a)
  })
})

describe('parseWorktreeList', () => {
  it('reads paths and branches, including detached worktrees', () => {
    const out = [
      'worktree /code/app',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /w/app-123456/claude-1-abcd',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/squadstorm/claude-1-abcd',
      '',
      'worktree /w/app-123456/detached',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      ''
    ].join('\n')
    expect(parseWorktreeList(out)).toEqual([
      { path: '/code/app', branch: 'main' },
      { path: '/w/app-123456/claude-1-abcd', branch: 'squadstorm/claude-1-abcd' },
      { path: '/w/app-123456/detached', branch: null }
    ])
  })
})

describe('prCommands', () => {
  it('pushes the branch and opens a PR against its base', () => {
    expect(prCommands({ path: '/w/x', branch: 'squadstorm/codex-1-beef', base: 'main' })).toEqual({
      push: ['push', '-u', 'origin', 'squadstorm/codex-1-beef'],
      pr: ['pr', 'create', '--head', 'squadstorm/codex-1-beef', '--base', 'main', '--fill']
    })
  })
})
