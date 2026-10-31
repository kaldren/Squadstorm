import { useCallback, useEffect, useRef, useState } from 'react'
import { parentDir, type FileEntry } from '@shared/files'
import type { ChangeKind, GitStatus } from '@shared/git'
import { SendIcon } from './SendIcon'

interface Props {
  root: string
  activePath: string | null
  onOpen(path: string): void
  /** Marks changed files, and the folders that contain them. */
  status?: GitStatus
  /** Sends a file to an agent (hover button on file rows). */
  onSend?(path: string): void
}

/** `a/b/c.ts` → `['a', 'a/b']`. */
const ancestors = (path: string) => {
  const parts = path.split('/').slice(0, -1)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

const KIND_COLOR: Record<ChangeKind, string> = {
  M: 'text-amber-400',
  A: 'text-emerald-400',
  D: 'text-danger',
  R: 'text-sky-400',
  C: 'text-danger'
}

export function FileTree({ root, activePath, onOpen, status, onSend }: Props) {
  const kinds = new Map(status?.changes.map((c) => [c.path, c.kind]))
  const changedDirs = new Set(status?.changes.flatMap((c) => ancestors(c.path)))
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
    listings[dir]?.map((entry) => {
      const kind = entry.dir ? undefined : kinds.get(entry.path)
      const changed = entry.dir && changedDirs.has(entry.path)
      return (
        <div key={entry.path}>
          <div
            role="treeitem"
            aria-expanded={entry.dir ? expanded.has(entry.path) : undefined}
            aria-selected={entry.path === activePath}
            data-testid="file-entry"
            data-git={kind ?? (changed ? 'changed' : undefined)}
            title={entry.path}
            className={`group flex h-6 cursor-pointer items-center gap-1 truncate pr-2 text-[13px] ${
              entry.path === activePath ? 'bg-raised text-fg' : 'text-fg/85 hover:bg-raised/60'
            }`}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => (entry.dir ? toggle(entry.path) : onOpen(entry.path))}
          >
            <span className="w-3 shrink-0 text-center text-[10px] text-muted">
              {entry.dir ? (expanded.has(entry.path) ? '▾' : '▸') : ''}
            </span>
            <span className={`truncate ${kind ? KIND_COLOR[kind] : ''}`}>{entry.name}</span>
            {changed && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/80" title="Contains changes" />}
            {onSend && !entry.dir && (
              <button
                className="ml-auto hidden shrink-0 rounded px-1 text-[11px] text-muted group-hover:block hover:text-fg"
                title="Send to an agent"
                aria-label={`Send ${entry.path} to an agent`}
                data-testid="send-file"
                onClick={(e) => {
                  e.stopPropagation()
                  onSend(entry.path)
                }}
              >
                <SendIcon />
              </button>
            )}
            {kind && (
              <span className={`ml-auto shrink-0 font-mono text-[10px] ${onSend ? 'group-hover:ml-0' : ''} ${KIND_COLOR[kind]}`}>{kind}</span>
            )}
          </div>
          {entry.dir && expanded.has(entry.path) && renderDir(entry.path, depth + 1)}
        </div>
      )
    })

  return (
    <div role="tree" className="min-h-0 flex-1 overflow-y-auto pb-2">
      {error ? <p className="px-3 text-xs text-danger">{error}</p> : renderDir('', 0)}
    </div>
  )
}
