import { describe, expect, it } from 'vitest'
import { bracketedPaste, findPathLinks, findUrlLinks, formatReference, quotePath } from '../src/shared/links'

const paths = (text: string) => findPathLinks(text).map(({ path, line, column }) => ({ path, line, column }))

describe('findPathLinks', () => {
  it('finds paths with and without line and column', () => {
    expect(paths('see a.ts:3 and src/b.tsx:12:7, then src/c.ts')).toEqual([
      { path: 'a.ts', line: 3, column: undefined },
      { path: 'src/b.tsx', line: 12, column: 7 },
      { path: 'src/c.ts', line: undefined, column: undefined }
    ])
  })

  it('strips surrounding punctuation', () => {
    expect(paths('(src/a.ts:3)')).toEqual([{ path: 'src/a.ts', line: 3, column: undefined }])
    expect(paths('Updated src/a.ts.')).toEqual([{ path: 'src/a.ts', line: undefined, column: undefined }])
    expect(paths('Read(src/shared/activity.ts)')).toEqual([{ path: 'src/shared/activity.ts', line: undefined, column: undefined }])
  })

  it('reports where the link is, including the line suffix', () => {
    const [link] = findPathLinks('at src/a.ts:42 ok')
    expect([link.start, link.end]).toEqual([3, 14])
  })

  it('accepts ./ but ignores absolute, Windows and URL paths', () => {
    expect(paths('./a.ts')).toEqual([{ path: 'a.ts', line: undefined, column: undefined }])
    expect(paths('/etc/passwd.d C:\\x\\y.ts https://x.com/a.ts')).toEqual([])
  })
})

describe('findUrlLinks', () => {
  it('finds http(s) URLs without trailing punctuation', () => {
    expect(findUrlLinks('Open https://example.com/x?y=1. Or (http://a.b/c)').map((l) => l.url)).toEqual([
      'https://example.com/x?y=1',
      'http://a.b/c'
    ])
  })

  it('ignores other schemes', () => {
    expect(findUrlLinks('file:///etc/passwd javascript:alert(1) ftp://x')).toEqual([])
  })
})

describe('formatReference', () => {
  it('formats a file, a line and a range, with an optional note', () => {
    expect(formatReference('src/a.ts')).toBe('src/a.ts')
    expect(formatReference('src/a.ts', 4)).toBe('src/a.ts:4')
    expect(formatReference('src/a.ts', 4, 4)).toBe('src/a.ts:4')
    expect(formatReference('src/a.ts', 2, 3, '  use a Map ')).toBe('src/a.ts:2-3 use a Map')
  })
})

describe('paste helpers', () => {
  it('wraps text as a bracketed paste and strips nested markers', () => {
    expect(bracketedPaste('a\x1b[201~b')).toBe('\x1b[200~ab\x1b[201~')
  })

  it('single-quotes paths for a shell', () => {
    expect(quotePath("/Users/me/it's here.png")).toBe(`'/Users/me/it'\\''s here.png'`)
  })
})
