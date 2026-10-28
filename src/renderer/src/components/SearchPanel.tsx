import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MAX_RESULTS, type FileResult, type SearchQuery, type SearchResult, type TextMatch } from '@shared/search'

interface Props {
  root: string
  visible: boolean
  /** Bumped to pull focus into the search box (⌘⇧F). */
  focusSignal: number
  /** The match currently open in the editor, highlighted in the list. */
  selected: { path: string; match: TextMatch } | null
  onOpen(path: string, match: TextMatch): void
}

const EMPTY: SearchQuery = { pattern: '', caseSensitive: false, wholeWord: false, regex: false, include: '', exclude: '' }

// Results are rebuilt by every search, so matches are compared by position, not identity.
const sameMatch = (a: TextMatch | null, b: TextMatch) => a !== null && a.line === b.line && a.column === b.column

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

function Toggle({ on, title, onClick, children }: { on: boolean; title: string; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      className={`flex h-5 min-w-5 items-center justify-center rounded px-0.5 font-mono text-[11px] ${
        on ? 'bg-accent/25 text-fg outline outline-accent/60' : 'text-muted hover:bg-raised hover:text-fg'
      }`}
      // Keep focus in the search box while toggling.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function FileGroup({
  file,
  collapsed,
  selected,
  onToggle,
  onOpen
}: {
  file: FileResult
  collapsed: boolean
  selected: TextMatch | null
  onToggle(): void
  onOpen(match: TextMatch): void
}) {
  const slash = file.path.lastIndexOf('/')
  return (
    <div data-testid="search-file">
      <div
        role="treeitem"
        aria-expanded={!collapsed}
        title={file.path}
        className="group flex h-6 cursor-pointer items-center gap-1 pr-2 pl-2 text-[13px] hover:bg-raised/60"
        onClick={onToggle}
      >
        <span className="w-3 shrink-0 text-center text-[10px] text-muted">{collapsed ? '▸' : '▾'}</span>
        <span className="shrink-0 text-fg">{file.path.slice(slash + 1)}</span>
        {slash > 0 && <span className="truncate text-xs text-muted">{file.path.slice(0, slash)}</span>}
        <span className="ml-auto shrink-0 rounded-full bg-raised px-1.5 text-[10px] text-fg">{file.matches.length}</span>
      </div>
      {!collapsed &&
        file.matches.map((m) => (
          <div
            key={`${m.line}:${m.column}`}
            role="treeitem"
            aria-selected={sameMatch(selected, m)}
            data-testid="search-match"
            title={`Line ${m.line}`}
            className={`flex h-6 cursor-pointer items-center truncate pr-2 pl-8 font-mono text-xs whitespace-pre ${
              sameMatch(selected, m) ? 'bg-raised text-fg' : 'text-fg/80 hover:bg-raised/60'
            }`}
            onClick={() => onOpen(m)}
          >
            <span className="truncate">
              {m.before}
              <span className="rounded-sm bg-accent/30 text-fg">{m.match}</span>
              {m.after}
            </span>
          </div>
        ))}
    </div>
  )
}

export function SearchPanel({ root, visible, focusSignal, selected, onOpen }: Props) {
  const [query, setQuery] = useState(EMPTY)
  const [showFilters, setShowFilters] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // Re-runs the search when files change on disk while results are showing.
  const [stale, setStale] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusSignal === 0) return
    input.current?.focus()
    input.current?.select()
  }, [focusSignal])

  // Search as you type, debounced; only the latest response is kept.
  useEffect(() => {
    if (!query.pattern) {
      setResult(null)
      setError(null)
      setSearching(false)
      return
    }
    let current = true
    setSearching(true)
    const timer = setTimeout(() => {
      window.api.files.search(root, query).then(
        (r) => {
          if (!current) return
          setResult(r)
          setError(null)
          setSearching(false)
        },
        (e: Error) => {
          if (!current) return
          setResult(null)
          setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
          setSearching(false)
        }
      )
    }, 200)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [root, query, stale])

  useEffect(
    () =>
      window.api.files.onChanged((changedRoot) => {
        if (changedRoot === root && visible && query.pattern) setStale((n) => n + 1)
      }),
    [root, visible, query.pattern]
  )

  const set = (patch: Partial<SearchQuery>) => setQuery((q) => ({ ...q, ...patch }))
  const total = result?.files.reduce((n, f) => n + f.matches.length, 0) ?? 0
  const allCollapsed = result !== null && result.files.length > 0 && result.files.every((f) => collapsed.has(f.path))

  const field = 'h-6 w-full rounded border border-line bg-bg px-2 text-xs outline-none placeholder:text-muted focus:border-accent'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-1.5 px-2 pb-2">
        <div className="flex items-center gap-1">
          <div className="flex h-7 min-w-0 flex-1 items-center rounded border border-line bg-bg pr-1 focus-within:border-accent">
            <input
              ref={input}
              data-testid="search-input"
              placeholder="Search"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent px-2 text-[13px] outline-none placeholder:text-muted"
              value={query.pattern}
              onChange={(e) => set({ pattern: e.target.value })}
              onKeyDown={(e) => {
                // e.code, since ⌥ turns the letter into a symbol on a Mac keyboard.
                if (e.altKey && !e.metaKey && !e.ctrlKey) {
                  const flag = ({ KeyC: 'caseSensitive', KeyW: 'wholeWord', KeyR: 'regex' } as const)[e.code as string]
                  if (flag) {
                    e.preventDefault()
                    set({ [flag]: !query[flag] })
                    return
                  }
                }
                if (e.key === 'Enter' && result?.files[0]) onOpen(result.files[0].path, result.files[0].matches[0])
                if (e.key === 'Escape') set({ pattern: '' })
              }}
            />
            <Toggle on={query.caseSensitive} title="Match Case (⌥C)" onClick={() => set({ caseSensitive: !query.caseSensitive })}>
              Aa
            </Toggle>
            <Toggle on={query.wholeWord} title="Match Whole Word (⌥W)" onClick={() => set({ wholeWord: !query.wholeWord })}>
              <span className="underline underline-offset-2">ab</span>
            </Toggle>
            <Toggle on={query.regex} title="Use Regular Expression (⌥R)" onClick={() => set({ regex: !query.regex })}>
              .*
            </Toggle>
          </div>
          <Toggle on={showFilters} title="Toggle Search Details" onClick={() => setShowFilters((s) => !s)}>
            ⋯
          </Toggle>
        </div>
        {showFilters && (
          <>
            <label className="flex flex-col gap-0.5 text-[11px] text-muted">
              files to include
              <input
                data-testid="search-include"
                className={field}
                placeholder="e.g. src, *.ts"
                spellCheck={false}
                value={query.include}
                onChange={(e) => set({ include: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-muted">
              files to exclude
              <input
                data-testid="search-exclude"
                className={field}
                placeholder="e.g. **/*.test.ts, dist"
                spellCheck={false}
                value={query.exclude}
                onChange={(e) => set({ exclude: e.target.value })}
              />
            </label>
          </>
        )}
        {(error || result || searching) && (
          <div className="flex items-center gap-2 text-[11px] text-muted" data-testid="search-summary">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : searching && !result ? (
              <span>Searching…</span>
            ) : result && total === 0 ? (
              <span>No results found</span>
            ) : result ? (
              <span className="truncate">
                {plural(total, 'result')} in {plural(result.files.length, 'file')}
                {searching && ' · searching…'}
              </span>
            ) : null}
            {result && result.files.length > 0 && (
              <button
                className="ml-auto shrink-0 hover:text-fg"
                onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(result.files.map((f) => f.path)))}
              >
                {allCollapsed ? 'Expand all' : 'Collapse all'}
              </button>
            )}
          </div>
        )}
        {result?.truncated && (
          <p className="text-[11px] text-muted">
            Showing the first {MAX_RESULTS.toLocaleString()} results. Narrow your search to see the rest.
          </p>
        )}
      </div>
      <div role="tree" className="min-h-0 flex-1 overflow-y-auto pb-2">
        {result?.files.map((f) => (
          <FileGroup
            key={f.path}
            file={f}
            collapsed={collapsed.has(f.path)}
            selected={selected?.path === f.path ? selected.match : null}
            onToggle={() =>
              setCollapsed((c) => {
                const next = new Set(c)
                if (!next.delete(f.path)) next.add(f.path)
                return next
              })
            }
            onOpen={(m) => onOpen(f.path, m)}
          />
        ))}
      </div>
    </div>
  )
}
