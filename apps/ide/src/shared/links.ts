/** A link found in a line of terminal output: 0-based [start, end) in UTF-16 code units. */
export interface PathLink {
  start: number
  end: number
  path: string
  /** 1-based. */
  line?: number
  column?: number
}

export interface UrlLink {
  start: number
  end: number
  url: string
}

// A relative path with a file extension, optionally followed by :line or :line:column.
// Not preceded by a word character, / or : (so URLs and absolute or Windows paths don't match).
const PATH = /(?<![\w/:\\.-])((?:\.{1,2}\/)?(?:[\w@.-]+\/)*[\w@.-]*[\w-]\.[A-Za-z0-9]+)(?::(\d+)(?::(\d+))?)?/g
const URL = /\bhttps?:\/\/[^\s<>"'`]+/g
// Characters that end a sentence or close a bracket are not part of a URL.
const URL_TRAILER = /[.,;:!?)\]}]+$/

/** Relative file paths in a line, with their line and column when given. */
export function findPathLinks(text: string): PathLink[] {
  const links: PathLink[] = []
  for (const m of text.matchAll(PATH)) {
    const [whole, path, line, column] = m
    // A version number or domain ("v1.2", "example.com/x" inside a URL) is handled by the callers'
    // existence check; here only skip what can never be a file: a bare extension like ".ts".
    if (path.startsWith('.') && !path.startsWith('./') && !path.startsWith('../')) continue
    links.push({
      start: m.index!,
      end: m.index! + whole.length,
      path: path.replace(/^\.\//, ''),
      line: line ? Number(line) : undefined,
      column: column ? Number(column) : undefined
    })
  }
  return links
}

/** http(s) URLs in a line, without trailing punctuation. */
export function findUrlLinks(text: string): UrlLink[] {
  return [...text.matchAll(URL)].map((m) => {
    const url = m[0].replace(URL_TRAILER, '')
    return { start: m.index!, end: m.index! + url.length, url }
  })
}

/** `src/a.ts:2-3 use a Map`: a file, a line, or a range of lines, then an optional note. */
export function formatReference(path: string, from?: number, to?: number, note?: string): string {
  const lines = from === undefined ? '' : to === undefined || to === from ? `:${from}` : `:${from}-${to}`
  const text = note?.trim()
  return `${path}${lines}${text ? ` ${text}` : ''}`
}

/** Text wrapped as a bracketed paste, so a TUI treats it as pasted (no autocomplete, no submit). */
export const bracketedPaste = (text: string) => `\x1b[200~${text.replace(/\x1b\[20[01]~/g, '')}\x1b[201~`

/** A path quoted for a POSIX shell (and readable by agent CLIs): `'it'\''s.png'`. */
export const quotePath = (path: string) => `'${path.replace(/'/g, `'\\''`)}'`
