import { describe, expect, it } from 'vitest'
import { bracketedPaste, cellRange, findPathLinks, findUrlLinks, formatReference, logicalLine, quotePath } from '../src/shared/links'

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

  it('cannot be ended early by crafted text, nested or not', () => {
    const pasted = bracketedPaste('x\x1b[20\x1b[201~1~\r<prompt>\r')
    // Only the wrapper's own markers remain, and no control character survives inside.
    expect(pasted.slice(6, -6)).not.toMatch(/[\x00-\x08\x0a-\x1f\x7f-\x9f]/)
    expect(pasted.match(/\x1b\[20[01]~/g)).toEqual(['\x1b[200~', '\x1b[201~'])
  })

  it('single-quotes paths for a shell', () => {
    expect(quotePath("/Users/me/it's here.png")).toBe(`'/Users/me/it'\\''s here.png'`)
  })
})

describe('logical lines', () => {
  const row = (y: number, text: string, wide = '') =>
    ({ y, cells: [...text].flatMap((ch) => (wide.includes(ch) ? [{ chars: ch, width: 2 }, { chars: '', width: 0 }] : [{ chars: ch, width: 1 }])) })

  it('maps text after wide characters to the right cells', () => {
    const { text, positions } = logicalLine([row(1, '修正 a.ts', '修正')])
    expect(text).toBe('修正 a.ts')
    expect(cellRange(positions, 3, 7)).toEqual({ start: { x: 6, y: 1 }, end: { x: 9, y: 1 } })
  })

  it('joins wrapped rows and trims the trailing blank cells', () => {
    const { text, positions } = logicalLine([row(4, 'see https://x.co'), row(5, 'm/long   ')])
    expect(text).toBe('see https://x.com/long')
    expect(cellRange(positions, 4, 22)).toEqual({ start: { x: 5, y: 4 }, end: { x: 6, y: 5 } })
  })
})

describe('more link edges', () => {
  it('keeps a closing parenthesis a URL opened', () => {
    expect(findUrlLinks('see https://en.wikipedia.org/wiki/Foo_(bar).').map((l) => l.url)).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
  })

  it('finds dotfile paths', () => {
    expect(findPathLinks('edit .github/workflows/ci.yml').map((l) => l.path)).toEqual(['.github/workflows/ci.yml'])
  })
})

