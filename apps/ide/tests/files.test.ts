import { describe, expect, it } from 'vitest'
import { resolveInside } from '../src/main/files'
import { fuzzyMatch, isWatched, parentDir, searchFiles, sortEntries } from '../src/shared/files'

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

describe('fuzzyMatch', () => {
  it('matches characters in order, ignoring case and spaces', () => {
    expect(fuzzyMatch('cv', 'src/CodeView.tsx')?.positions).toEqual([4, 8])
    expect(fuzzyMatch('code view', 'src/CodeView.tsx')).not.toBeNull()
    expect(fuzzyMatch('vc', 'src/CodeView.tsx')).toBeNull()
  })

  it('prefers matches in the file name', () => {
    expect(fuzzyMatch('src', 'src/renderer/src/a.ts')?.positions).toEqual([13, 14, 15])
  })
})

describe('searchFiles', () => {
  const paths = [
    'src/renderer/src/components/CodeEditor.tsx',
    'src/renderer/src/components/CodeView.tsx',
    'tests/fixtures/deep/view.ts',
    'src/view.ts',
    'README.md'
  ]

  it('ranks name and boundary matches first', () => {
    expect(searchFiles('codeview', paths)[0].path).toBe('src/renderer/src/components/CodeView.tsx')
    expect(searchFiles('cv', paths)[0].path).toBe('src/renderer/src/components/CodeView.tsx')
    expect(searchFiles('view', paths).map((m) => m.path).slice(0, 2)).toEqual(['src/view.ts', 'tests/fixtures/deep/view.ts'])
  })

  it('drops non-matches and keeps order for an empty query', () => {
    expect(searchFiles('zzz', paths)).toEqual([])
    expect(searchFiles('', paths).map((m) => m.path)).toEqual(paths)
    expect(searchFiles('', paths, 2)).toHaveLength(2)
  })
})
