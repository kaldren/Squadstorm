import { mkdirSync, mkdtempSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readImage, resolveInside } from '../src/main/files'
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

describe('readImage', () => {
  const root = mkdtempSync(join(tmpdir(), 'squadstorm-images-'))
  // A 1×1 PNG.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  writeFileSync(join(root, 'logo.png'), png)
  writeFileSync(join(root, 'notes.txt'), 'not an image')
  // Sparse, so it takes no real space.
  writeFileSync(join(root, 'huge.png'), '')
  truncateSync(join(root, 'huge.png'), 11 * 1024 * 1024)
  // What a cloned repo could hold: links out of it, to a device, and a folder named like an image.
  const outside = mkdtempSync(join(tmpdir(), 'squadstorm-outside-'))
  writeFileSync(join(outside, 'secret.png'), png)
  symlinkSync(join(outside, 'secret.png'), join(root, 'escape.png'))
  symlinkSync('/dev/zero', join(root, 'zero.png'))
  mkdirSync(join(root, 'folder.png'))
  symlinkSync('logo.png', join(root, 'alias.png'))

  it('returns a data: URL', async () => {
    expect(await readImage(root, 'logo.png')).toBe(`data:image/png;base64,${png.toString('base64')}`)
  })

  it('refuses paths outside the workspace', async () => {
    await expect(readImage(root, '../x.png')).rejects.toThrow(/outside the workspace/)
  })

  it('refuses files that are not images', async () => {
    await expect(readImage(root, 'notes.txt')).rejects.toThrow(/Not an image/)
  })

  it('follows symlinks that stay inside the workspace', async () => {
    expect(await readImage(root, 'alias.png')).toMatch(/^data:image\/png;base64,/)
  })

  it('refuses symlinks that lead out of the workspace', async () => {
    await expect(readImage(root, 'escape.png')).rejects.toThrow(/outside the workspace/)
    await expect(readImage(root, 'zero.png')).rejects.toThrow(/outside the workspace/)
  })

  it('refuses anything that is not a regular file', async () => {
    await expect(readImage(root, 'folder.png')).rejects.toThrow(/Not an image/)
  })

  it('refuses images over 10 MB', async () => {
    await expect(readImage(root, 'huge.png')).rejects.toThrow(/too large/)
  })
})
