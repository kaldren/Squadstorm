import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { searchFiles, type FileMatch } from '@shared/files'

interface Props {
  root: string
  onOpen(path: string): void
  onClose(): void
}

/** Shows `text` with the characters at `positions` (offset by `from`) highlighted. */
function Highlighted({ text, positions, from }: { text: string; positions: ReadonlySet<number>; from: number }) {
  return (
    <>
      {Array.from(text, (ch, i) =>
        positions.has(from + i) ? (
          <span key={i} className="text-accent">
            {ch}
          </span>
        ) : (
          ch
        )
      )}
    </>
  )
}

function Result({ match, selected, onPick }: { match: FileMatch; selected: boolean; onPick(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  const slash = match.path.lastIndexOf('/')
  const positions = new Set(match.positions)
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      data-testid="quick-open-result"
      className={`flex h-7 cursor-pointer items-baseline gap-2 truncate px-3 text-[13px] ${selected ? 'bg-raised' : 'hover:bg-raised/60'}`}
      // mousedown, not click, so the input never loses focus first.
      onMouseDown={(e) => {
        e.preventDefault()
        onPick()
      }}
    >
      <span className="shrink-0 text-fg">
        <Highlighted text={match.path.slice(slash + 1)} positions={positions} from={slash + 1} />
      </span>
      {slash > 0 && (
        <span className="truncate text-xs text-muted">
          <Highlighted text={match.path.slice(0, slash)} positions={positions} from={0} />
        </span>
      )}
    </div>
  )
}

export function QuickOpen({ root, onOpen, onClose }: Props) {
  const [files, setFiles] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)

  // Listed fresh on every open, since agents add and remove files all the time.
  useEffect(() => {
    window.api.files.all(root).then(setFiles, (e: Error) =>
      setError(e.message.replace(/^Error invoking remote method '[^']+': /, ''))
    )
  }, [root])

  const results = useMemo(() => searchFiles(query, files ?? []), [query, files])

  const pick = (path: string | undefined) => {
    if (!path) return
    onOpen(path)
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const move = (by: number) => {
      e.preventDefault()
      if (results.length > 0) setSelected((s) => (s + by + results.length) % results.length)
    }
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) move(1)
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) move(-1)
    else if (e.key === 'Enter') {
      e.preventDefault()
      pick(results[selected]?.path)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex justify-center bg-black/30 pt-16" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Go to file"
        className="flex h-fit max-h-[60%] w-[560px] max-w-[calc(100%-32px)] flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          data-testid="quick-open-input"
          placeholder="Search files by name"
          spellCheck={false}
          className="h-10 shrink-0 border-b border-line bg-transparent px-3 text-sm outline-none placeholder:text-muted"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
          onBlur={onClose}
        />
        <div role="listbox" className="min-h-0 overflow-y-auto py-1">
          {error ? (
            <p className="px-3 py-1 text-xs text-danger">{error}</p>
          ) : files === null ? (
            <p className="px-3 py-1 text-xs text-muted">Loading files…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-1 text-xs text-muted">No matching files</p>
          ) : (
            results.map((m, i) => (
              <Result key={m.path} match={m} selected={i === selected} onPick={() => pick(m.path)} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
