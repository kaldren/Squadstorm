import { describe, expect, it } from 'vitest'
import { MAX_NAME, branchName, nameError, nameSlug, namedBranch, prCommands, slug, worktreeDir } from '../src/shared/worktrees'

describe('branch names', () => {
  it('slugs the agent label and adds the suffix', () => {
    expect(branchName('Claude 2', '9f3a')).toBe('squadstorm/claude-2-9f3a')
    expect(branchName('  Ünïcode / agent!! ', '0001')).toBe('squadstorm/n-code-agent-0001')
  })

  it('never produces an empty slug', () => {
    expect(slug('!!!')).toBe('agent')
  })
})

describe('branch names from a typed name', () => {
  it('slugs what was typed', () => {
    expect(nameSlug('Login fix!')).toBe('login-fix')
    expect(nameSlug('  Ünïcode / Agent ')).toBe('n-code-agent')
    expect(namedBranch('Login fix!')).toBe('squadstorm/login-fix')
  })

  it('leaves a name with nothing usable empty', () => {
    expect(nameSlug('!!!')).toBe('')
  })

  it('accepts a blank name (automatic) and a usable one', () => {
    expect(nameError('')).toBeNull()
    expect(nameError('   ')).toBeNull()
    expect(nameError('Login fix')).toBeNull()
    expect(nameError('a'.repeat(MAX_NAME))).toBeNull()
  })

  it('refuses names without letters or digits, and names that are too long', () => {
    expect(nameError('!!!')).toBe('Use letters or digits.')
    expect(MAX_NAME).toBe(60)
    expect(nameError('a'.repeat(61))).toBe('Use at most 60 characters.')
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

describe('prCommands', () => {
  it('pushes the branch and opens a PR against its base', () => {
    expect(prCommands({ path: '/w/x', branch: 'squadstorm/codex-1-beef', base: 'main' })).toEqual({
      push: ['push', '-u', 'origin', 'squadstorm/codex-1-beef'],
      pr: ['pr', 'create', '--head', 'squadstorm/codex-1-beef', '--base', 'main', '--fill']
    })
  })
})
