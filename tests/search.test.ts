import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { searchWorkspace } from '../src/main/search'
import { buildRegExp, globToRegExp, pathFilter, searchText, type SearchQuery } from '../src/shared/search'

const q = (pattern: string, opts: Partial<SearchQuery> = {}): SearchQuery => ({
  pattern,
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  include: '',
  exclude: '',
  ...opts
})

const found = (content: string, query: SearchQuery) => searchText(content, buildRegExp(query)).map((m) => m.match)

describe('buildRegExp + searchText', () => {
  const text = 'const Foo = foo.bar\nfoobar(a.b)\n'

  it('matches literally and case-insensitively by default', () => {
    expect(found(text, q('foo'))).toEqual(['Foo', 'foo', 'foo'])
    expect(found(text, q('a.b'))).toEqual(['a.b'])
  })

  it('honors match case, whole word and regex', () => {
    expect(found(text, q('foo', { caseSensitive: true }))).toEqual(['foo', 'foo'])
    expect(found(text, q('foo', { wholeWord: true }))).toEqual(['Foo', 'foo'])
    expect(found(text, q('fo+b', { regex: true }))).toEqual(['foob'])
    expect(found(text, q('a|b', { regex: true, wholeWord: true }))).toEqual(['a', 'b'])
  })

  it('reports 1-based lines and columns, several per line', () => {
    const matches = searchText('x\n  ab ab\r\nab', buildRegExp(q('ab')))
    expect(matches.map((m) => [m.line, m.column])).toEqual([[2, 2], [2, 5], [3, 0]])
    expect(matches[0]).toMatchObject({ before: '', match: 'ab', after: ' ab' })
  })

  it('skips empty regex matches without hanging', () => {
    expect(found('abc', q('x*', { regex: true }))).toEqual([])
  })

  it('stops at the limit and trims long lines', () => {
    expect(searchText('a a a a', buildRegExp(q('a')), 2)).toHaveLength(2)
    const [m] = searchText(`${'x'.repeat(100)}needle`, buildRegExp(q('needle')))
    expect(m.before.startsWith('…')).toBe(true)
    expect(m.before.length).toBeLessThan(50)
  })

  it('explains an invalid regex', () => {
    expect(() => buildRegExp(q('(', { regex: true }))).toThrow(/Invalid regex/)
  })
})

describe('globs', () => {
  it.each([
    ['*.ts', 'src/a.ts', true],
    ['*.ts', 'a.tsx', false],
    ['src', 'src/main/a.ts', true],
    ['src', 'lib/src/a.ts', true],
    ['./src', 'lib/src/a.ts', false],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/main/a.ts', false],
    ['src/**/*.ts', 'src/main/deep/a.ts', true],
    ['**/*.test.ts', 'tests/a.test.ts', true],
    ['*.{ts,tsx}', 'a.tsx', true],
    ['?.md', 'a.md', true],
    ['?.md', 'ab.md', false]
  ])('%s on %s → %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected)
  })

  it('combines comma-separated includes and excludes', () => {
    const keep = pathFilter('src, *.md', '*.test.ts, src/{gen,dist}')
    expect(keep('src/a.ts')).toBe(true)
    expect(keep('README.md')).toBe(true)
    expect(keep('lib/a.ts')).toBe(false)
    expect(keep('src/a.test.ts')).toBe(false)
    expect(keep('src/gen/a.ts')).toBe(false)
    expect(pathFilter('', '')('anything')).toBe(true)
  })
})

describe('searchWorkspace', () => {
  it('searches text files, skipping binaries, node_modules and filtered paths', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'squadstorm-search-')))
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'src', 'b.ts'), 'needle\nhay needle\n')
    writeFileSync(join(root, 'src', 'a.ts'), 'needle')
    writeFileSync(join(root, 'notes.md'), 'needle')
    writeFileSync(join(root, 'node_modules', 'x.js'), 'needle')
    writeFileSync(join(root, 'img.bin'), Buffer.from([0, 110, 101, 101, 100, 108, 101]))

    const all = await searchWorkspace(root, q('needle'))
    expect(all.files.map((f) => [f.path, f.matches.length])).toEqual([
      ['notes.md', 1],
      ['src/a.ts', 1],
      ['src/b.ts', 2]
    ])
    expect(all.truncated).toBe(false)

    const filtered = await searchWorkspace(root, q('needle', { include: 'src', exclude: 'a.ts' }))
    expect(filtered.files.map((f) => f.path)).toEqual(['src/b.ts'])
    expect((await searchWorkspace(root, q(''))).files).toEqual([])
  })
})
