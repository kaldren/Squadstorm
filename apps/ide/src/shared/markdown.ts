// Pure helpers for the markdown preview. Paths are relative to the workspace root and `/`-separated.

import { parentDir } from './files'

export const isMarkdown = (path: string) => /\.md$/i.test(path)

export type LinkTarget = { kind: 'external'; url: string } | { kind: 'file'; path: string } | { kind: 'anchor'; id: string }
export type ImageTarget = { kind: 'repo'; path: string } | { kind: 'web'; url: string }

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

const decode = (text: string) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** Joins a relative path onto a directory, applying `.` and `..`; null when it climbs out of the root. */
export function joinInside(dir: string, rel: string): string | null {
  // A leading `/` means the repo root, as on GitHub.
  const parts = rel.startsWith('/') ? [] : dir.split('/').filter(Boolean)
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(part)
  }
  return parts.length > 0 ? parts.join('/') : null
}

/** A path in the repo named relative to `fromPath`, without its `#fragment` or `?query`. */
const repoPath = (fromPath: string, ref: string) => {
  const path = ref.split(/[?#]/)[0]
  return path ? joinInside(parentDir(fromPath), decode(path)) : null
}

/** Where a link in the markdown file at `fromPath` leads; null for anything the preview won't follow. */
export function resolveLink(fromPath: string, href: string): LinkTarget | null {
  const ref = href.trim()
  if (/^https?:\/\//i.test(ref)) return { kind: 'external', url: ref }
  if (ref.startsWith('#')) return ref.length > 1 ? { kind: 'anchor', id: decode(ref.slice(1)) } : null
  if (SCHEME.test(ref)) return null
  const path = repoPath(fromPath, ref)
  return path === null ? null : { kind: 'file', path }
}

/** Where an image in the markdown file at `fromPath` comes from; null for anything the preview won't load. */
export function resolveImage(fromPath: string, src: string): ImageTarget | null {
  const ref = src.trim()
  if (/^https:\/\//i.test(ref)) return { kind: 'web', url: ref }
  if (SCHEME.test(ref) || ref.startsWith('//')) return null
  const path = repoPath(fromPath, ref)
  return path === null ? null : { kind: 'repo', path }
}

/** Heading ids the way GitHub makes them; repeats in one document get `-1`, `-2`, …. */
export function slugger(): (text: string) => string {
  const seen = new Map<string, number>()
  return (text) => {
    const base = text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-')
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  }
}
