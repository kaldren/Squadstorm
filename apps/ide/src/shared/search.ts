export interface SearchQuery {
  pattern: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  /** Comma-separated globs, like VS Code's "files to include" / "files to exclude". */
  include: string
  exclude: string
}

export interface TextMatch {
  /** 1-based. */
  line: number
  /** 0-based, in UTF-16 code units like CodeMirror positions. */
  column: number
  length: number
  /** The line around the match, trimmed so long lines stay readable. */
  before: string
  match: string
  after: string
}

export interface FileResult {
  path: string
  matches: TextMatch[]
}

export interface SearchResult {
  files: FileResult[]
  /** True when the search stopped at the result limit. */
  truncated: boolean
}

export const MAX_RESULTS = 5000

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The regex a query searches with. Throws a readable error for an invalid pattern. */
export function buildRegExp(query: Pick<SearchQuery, 'pattern' | 'caseSensitive' | 'wholeWord' | 'regex'>): RegExp {
  let source = query.regex ? query.pattern : escapeRegExp(query.pattern)
  if (query.wholeWord) source = `\\b(?:${source})\\b`
  try {
    return new RegExp(source, query.caseSensitive ? 'g' : 'gi')
  } catch (e) {
    throw new Error((e as Error).message.replace(/^Invalid regular expression: /, 'Invalid regex: '))
  }
}

const PREVIEW_BEFORE = 40
const PREVIEW_TOTAL = 250

/** Every match of `regex` (which must have the g flag), line by line. */
export function searchText(content: string, regex: RegExp, limit = Infinity): TextMatch[] {
  const matches: TextMatch[] = []
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length && matches.length < limit; i++) {
    const text = lines[i]
    regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(text)) !== null && matches.length < limit) {
      // An empty match would loop forever; step past it and don't report it.
      if (m[0].length === 0) {
        regex.lastIndex++
        continue
      }
      const start = Math.max(0, m.index - PREVIEW_BEFORE)
      const before = text.slice(start, m.index)
      matches.push({
        line: i + 1,
        column: m.index,
        length: m[0].length,
        before: start > 0 ? `…${before}` : before.trimStart(),
        match: m[0].slice(0, PREVIEW_TOTAL),
        after: text.slice(m.index + m[0].length, m.index + m[0].length + Math.max(0, PREVIEW_TOTAL - m[0].length))
      })
    }
  }
  return matches
}

/** Splits on commas that are not inside `{a,b}` alternatives. */
function splitGlobs(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const ch of list) {
    if (ch === ',' && depth === 0) {
      out.push(current)
      current = ''
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}' && depth > 0) depth--
    current += ch
  }
  out.push(current)
  return out.map((g) => g.trim()).filter(Boolean)
}

/**
 * VS Code-style glob: `*` and `?` stay within a path segment, `**` crosses them, `{a,b}`
 * picks one. A glob not anchored with `./` or `/` matches at any depth, and matching a
 * folder matches everything inside it.
 */
export function globToRegExp(glob: string): RegExp {
  let g = glob.replace(/\\/g, '/')
  let anchored = false
  if (g.startsWith('./') || g.startsWith('/')) {
    g = g.replace(/^\.?\/+/, '')
    anchored = true
  }
  g = g.replace(/\/+$/, '')
  let re = ''
  let depth = 0
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++
        if (g[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      re += '(?:'
      depth++
    } else if (c === '}' && depth > 0) {
      re += ')'
      depth--
    } else if (c === ',' && depth > 0) re += '|'
    else re += escapeRegExp(c)
  }
  re += ')'.repeat(depth)
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${re}(?:/.*)?$`)
}

/** Whether a path passes a query's include and exclude globs. */
export function pathFilter(include: string, exclude: string): (path: string) => boolean {
  const inc = splitGlobs(include).map(globToRegExp)
  const exc = splitGlobs(exclude).map(globToRegExp)
  return (path) => (inc.length === 0 || inc.some((r) => r.test(path))) && !exc.some((r) => r.test(path))
}
