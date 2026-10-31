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
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/g
// Characters that end a sentence are not part of a URL, nor is a closing bracket it didn't open.
const URL_TRAILER = /[.,;:!?\]}]+$/

function trimUrl(url: string): string {
  let trimmed = url.replace(URL_TRAILER, '')
  while (trimmed.endsWith(')') && (trimmed.match(/\(/g) ?? []).length < (trimmed.match(/\)/g) ?? []).length) {
    trimmed = trimmed.slice(0, -1).replace(URL_TRAILER, '')
  }
  return trimmed
}

/** Relative file paths in a line, with their line and column when given. */
export function findPathLinks(text: string): PathLink[] {
  const links: PathLink[] = []
  for (const m of text.matchAll(PATH)) {
    const [whole, path, line, column] = m
    // Callers only keep paths that exist, which weeds out version numbers and domains; a bare
    // extension like ".ts" in prose is skipped here (dotfiles like .github/ci.yml are kept).
    if (/^\.[A-Za-z0-9]+$/.test(path)) continue
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
  return [...text.matchAll(URL_RE)].map((m) => {
    const url = trimUrl(m[0])
    return { start: m.index!, end: m.index! + url.length, url }
  })
}

/** `src/a.ts:2-3 use a Map`: a file, a line, or a range of lines, then an optional note. */
export function formatReference(path: string, from?: number, to?: number, note?: string): string {
  const lines = from === undefined ? '' : to === undefined || to === from ? `:${from}` : `:${from}-${to}`
  const text = note?.trim()
  return `${path}${lines}${text ? ` ${text}` : ''}`
}

/**
 * Text wrapped as a bracketed paste, so a TUI treats it as pasted (no autocomplete, no submit). Control
 * characters (escapes, carriage returns: anything but tab) are dropped, so text from file names can
 * never end the paste early or submit anything.
 */
export function bracketedPaste(text: string): string {
  let clean = text
  // Markers first, until none are left (removing one can form another), then any other control.
  for (let prev = ''; prev !== clean; ) {
    prev = clean
    clean = clean.replace(/\x1b\[20[01]~/g, '')
  }
  clean = clean.replace(/[\x00-\x08\x0a-\x1f\x7f-\x9f]/g, '')
  return `\x1b[200~${clean}\x1b[201~`
}

/** One terminal cell, as xterm reports it: its characters and width (2 for wide, 0 for the second half). */
export interface Cell {
  chars: string
  width: number
}

/** Where a UTF-16 unit of a logical line sits on screen: 1-based column and row, and its cell's width. */
export interface CellPosition {
  x: number
  y: number
  width: number
}

/**
 * Joins the rows of one logical line (a line the terminal wrapped) into text, remembering the cell of
 * every UTF-16 unit, so matches in the text map back to screen ranges even past wide characters.
 */
export function logicalLine(rows: { y: number; cells: Cell[] }[]): { text: string; positions: CellPosition[] } {
  let text = ''
  const positions: CellPosition[] = []
  for (const row of rows) {
    row.cells.forEach((cell, i) => {
      if (cell.width === 0) return
      const chars = cell.chars || ' '
      text += chars
      for (let k = 0; k < chars.length; k++) positions.push({ x: i + 1, y: row.y, width: cell.width })
    })
  }
  const trimmed = text.replace(/ +$/, '')
  return { text: trimmed, positions: positions.slice(0, trimmed.length) }
}

/** The screen range (inclusive, 1-based, as xterm wants it) of text[start, end) in a logical line. */
export function cellRange(positions: CellPosition[], start: number, end: number) {
  const first = positions[start]
  const last = positions[end - 1]
  return { start: { x: first.x, y: first.y }, end: { x: last.x + last.width - 1, y: last.y } }
}

/** A path quoted for a POSIX shell (and readable by agent CLIs): `'it'\''s.png'`. */
export const quotePath = (path: string) => `'${path.replace(/'/g, `'\\''`)}'`
