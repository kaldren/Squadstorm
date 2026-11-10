import { describe, expect, it } from 'vitest'
import { isMarkdown, joinInside, resolveImage, resolveLink, slugger } from '../src/shared/markdown'

describe('isMarkdown', () => {
  it.each(['a/b.md', 'README.MD', 'notes.Md'])('%s is markdown', (path) => {
    expect(isMarkdown(path)).toBe(true)
  })

  it.each(['a.markdown', 'a.mdx', 'a.ts', 'md', 'a.md.ts'])('%s is not', (path) => {
    expect(isMarkdown(path)).toBe(false)
  })
})

describe('joinInside', () => {
  it('applies . and ..', () => {
    expect(joinInside('docs', './img/../logo.png')).toBe('docs/logo.png')
    expect(joinInside('', 'a/b')).toBe('a/b')
  })

  it('treats a leading / as the repo root', () => {
    expect(joinInside('docs/deep', '/README.md')).toBe('README.md')
  })

  it('refuses to climb out of the root', () => {
    expect(joinInside('docs', '../../x')).toBeNull()
    expect(joinInside('docs', '..')).toBeNull()
  })
})

describe('resolveLink', () => {
  const from = 'docs/guide.md'

  it('sends web links to the browser', () => {
    expect(resolveLink(from, 'https://x.y/')).toEqual({ kind: 'external', url: 'https://x.y/' })
    expect(resolveLink(from, 'http://x.y/a')).toEqual({ kind: 'external', url: 'http://x.y/a' })
    expect(resolveLink(from, 'HTTPS://x.y/A')).toEqual({ kind: 'external', url: 'https://x.y/A' })
  })

  it('opens relative links as repo files, dropping the fragment', () => {
    expect(resolveLink(from, 'notes.md')).toEqual({ kind: 'file', path: 'docs/notes.md' })
    expect(resolveLink(from, '../README.md#top')).toEqual({ kind: 'file', path: 'README.md' })
    expect(resolveLink(from, 'my%20notes.md')).toEqual({ kind: 'file', path: 'docs/my notes.md' })
  })

  it('scrolls to anchors', () => {
    expect(resolveLink(from, '#setup')).toEqual({ kind: 'anchor', id: 'setup' })
  })

  it.each(['../../etc/passwd', 'javascript:alert(1)', 'file:///etc/passwd', 'mailto:a@b.c', '#', '', '//host/x', 'examples/', 'examples/#top'])(
    'follows nothing for %s',
    (href) => {
      expect(resolveLink(from, href)).toBeNull()
    }
  )
})

describe('resolveImage', () => {
  const from = 'docs/guide.md'

  it('reads repo images relative to the file', () => {
    expect(resolveImage(from, 'img/logo.png')).toEqual({ kind: 'repo', path: 'docs/img/logo.png' })
  })

  it('loads https images from the web', () => {
    expect(resolveImage(from, 'https://x.y/a.png')).toEqual({ kind: 'web', url: 'https://x.y/a.png' })
  })

  it.each(['http://x.y/a.png', 'data:image/png;base64,AAAA', 'file:///etc/a.png', '//x.y/a.png', '../../a.png'])(
    'loads nothing for %s',
    (src) => {
      expect(resolveImage(from, src)).toBeNull()
    }
  )
})

describe('slugger', () => {
  it('makes GitHub-style heading ids', () => {
    const slug = slugger()
    expect(slug('Getting Started!')).toBe('getting-started')
    expect(slug('Getting Started')).toBe('getting-started-1')
    expect(slug('Über `code` & more')).toBe('über-code--more')
  })

  it('starts counting again for each document', () => {
    expect(slugger()('Setup')).toBe('setup')
    expect(slugger()('Setup')).toBe('setup')
  })
})
