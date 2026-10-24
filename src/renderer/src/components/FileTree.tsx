import { useCallback, useEffect, useRef, useState } from 'react'
import { parentDir, type FileEntry } from '@shared/files'

interface Props {
  root: string
  activePath: string | null
  onOpen(path: string): void
}

export function FileTree({ root, activePath, onOpen }: Props) {
  // Listings keyed by directory ('' is the root); only directories that were opened are loaded.
  const [listings, setListings] = useState<Record<string, FileEntry[]>>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const listingsRef = useRef(listings)
  listingsRef.current = listings

  const load = useCallback(
    async (dir: string) => {
      try {
        const entries = await window.api.files.list(root, dir)
        setListings((l) => ({ ...l, [dir]: entries }))
        if (dir === '') setError(null)
      } catch (e) {
        if (dir === '') setError((e as Error).message.replace(/^Error invoking remote method '[^']+': /, ''))
        // A subdirectory that vanished just drops out of the tree.
        setListings(({ [dir]: _gone, ...rest }) => rest)
      }
    },
    [root]
  )

  useEffect(() => {
    void load('')
  }, [load])

  // Refresh only the loaded directories that contain a change.
  useEffect(
    () =>
      window.api.files.onChanged((changedRoot, paths) => {
        if (changedRoot !== root) return
        for (const dir of new Set(paths.map(parentDir))) {
          if (dir in listingsRef.current) void load(dir)
        }
      }),
    [root, load]
  )

  const toggle = (dir: string) => {
    const next = new Set(expanded)
    if (next.has(dir)) next.delete(dir)
    else {
      next.add(dir)
      void load(dir)
    }
    setExpanded(next)
  }

  const renderDir = (dir: string, depth: number) =>
    listings[dir]?.map((entry) => (
      <div key={entry.path}>
        <div
          role="treeitem"
          aria-expanded={entry.dir ? expanded.has(entry.path) : undefined}
          aria-selected={entry.path === activePath}
          data-testid="file-entry"
          title={entry.path}
          className={`flex h-6 cursor-pointer items-center gap-1 truncate pr-2 text-[13px] ${
            entry.path === activePath ? 'bg-raised text-fg' : 'text-fg/85 hover:bg-raised/60'
          }`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => (entry.dir ? toggle(entry.path) : onOpen(entry.path))}
        >
          <span className="w-3 shrink-0 text-center text-[10px] text-muted">
            {entry.dir ? (expanded.has(entry.path) ? '▾' : '▸') : ''}
          </span>
          <span className="truncate">{entry.name}</span>
        </div>
        {entry.dir && expanded.has(entry.path) && renderDir(entry.path, depth + 1)}
      </div>
    ))

  return (
    <div className="flex h-full flex-col border-r border-line bg-panel">
      <div className="flex h-8 shrink-0 items-center px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
        Files
      </div>
      <div role="tree" className="min-h-0 flex-1 overflow-y-auto pb-2">
        {error ? <p className="px-3 text-xs text-danger">{error}</p> : renderDir('', 0)}
      </div>
    </div>
  )
}
