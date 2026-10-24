import { describe, expect, it } from 'vitest'
import { resolveInside } from '../src/main/files'
import { isWatched, parentDir, sortEntries } from '../src/shared/files'

describe('resolveInside', () => {
  it('resolves paths within the root', () => {
    expect(resolveInside('/proj', 'src/a.ts')).toBe('/proj/src/a.ts')
    expect(resolveInside('/proj', '')).toBe('/proj')
  })

  it.each(['../etc/passwd', 'src/../../x', '/etc/passwd'])('refuses %s', (path) => {
    expect(() => resolveInside('/proj', path)).toThrow(/outside the workspace/)
  })
})

describe('sortEntries', () => {
  it('lists directories first, then names case-insensitively', () => {
    const entries = [
      { name: 'b.ts', path: 'b.ts', dir: false },
      { name: 'src', path: 'src', dir: true },
      { name: 'A.md', path: 'A.md', dir: false },
      { name: '.github', path: '.github', dir: true }
    ]
    expect(sortEntries(entries).map((e) => e.name)).toEqual(['.github', 'src', 'A.md', 'b.ts'])
  })
})

describe('isWatched', () => {
  it.each([
    ['src/a.ts', true],
    ['.gitignore', true],
    ['.git/index', false],
    ['node_modules/x/index.js', false],
    ['packages/app/node_modules/y', false]
  ])('%s → %s', (path, watched) => {
    expect(isWatched(path)).toBe(watched)
  })
})

it('parentDir', () => {
  expect(parentDir('a.ts')).toBe('')
  expect(parentDir('src/lib/a.ts')).toBe('src/lib')
})
