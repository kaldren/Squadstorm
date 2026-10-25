import { useCallback, useEffect, useState } from 'react'
import type { Commit, FileChange, GitStatus } from '@shared/git'
import { KIND_STYLE } from './ChangesPanel'

const relativeTime = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  for (const [unit, size] of [
    ['y', 31_536_000],
    ['mo', 2_592_000],
    ['d', 86_400],
    ['h', 3600],
    ['m', 60]
  ] as const) {
    if (s >= size) return `${Math.floor(s / size)}${unit} ago`
  }
  return 'just now'
}

interface Props {
  root: string
  status: GitStatus
  visible: boolean
  /** The commit file whose diff is open. */
  selected: { hash: string; path: string } | null
  onSelect(commit: Commit, change: FileChange): void
}

/**
 * Recent commits on the current branch. Commits not yet on the upstream are marked as unpushed.
 * Clicking one lists the files it changed; clicking a file opens what the commit did to it.
 */
export function HistoryPanel({ root, status, visible, selected, onSelect }: Props) {
  const [commits, setCommits] = useState<Commit[] | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  // A commit's files never change, so each is fetched once.
  const [files, setFiles] = useState<Record<string, FileChange[] | string>>({})
  const refresh = useCallback(async () => setCommits(await window.api.git.log(root)), [root])

  // Agents commit from their terminals, so follow focus and a slow timer like the status does,
  // and refetch right away when the status shows a new commit or branch.
  useEffect(() => {
    if (!visible) return
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    const timer = setInterval(onFocus, 4000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(timer)
    }
  }, [visible, refresh, status.branch, status.ahead, status.changes.length])

  const toggle = (hash: string) => {
    const next = new Set(expanded)
    if (next.delete(hash)) return setExpanded(next)
    setExpanded(next.add(hash))
    if (files[hash]) return
    window.api.git.commitFiles(root, hash).then(
      (changes) => setFiles((f) => ({ ...f, [hash]: changes })),
      (e: Error) => setFiles((f) => ({ ...f, [hash]: e.message }))
    )
  }

  if (!status.repo || commits === null) return null
  if (commits.length === 0) return <p className="px-3 py-2 text-xs text-muted">No commits yet.</p>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2 text-xs text-muted truncate" title="Current branch">
        {status.branch ?? 'detached HEAD'}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {commits.map((commit, i) => {
          const unpushed = status.upstream && i < status.ahead
          const refs = commit.refs.map((r) => r.replace(/^HEAD -> /, '')).filter((r) => r !== 'HEAD')
          const open = expanded.has(commit.hash)
          const changed = files[commit.hash]
          return (
            <div key={commit.hash}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={open}
                data-testid="commit-entry"
                title={`${commit.hash}\n${commit.author}, ${new Date(commit.date).toLocaleString()}\n\n${commit.subject}`}
                className={`flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 text-[13px] ${open ? 'bg-raised/40' : 'hover:bg-raised/60'}`}
                onClick={() => toggle(commit.hash)}
                onKeyDown={(e) => e.key === 'Enter' && toggle(commit.hash)}
              >
                <div className="flex items-center gap-1.5">
                  {unpushed && (
                    <span className="shrink-0 text-[11px] text-amber-400" title="Not pushed yet">
                      ↑
                    </span>
                  )}
                  <span className="w-2.5 shrink-0 text-[10px] text-muted">{open ? '▾' : '▸'}</span>
                  <span className="truncate text-fg/90">{commit.subject}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="font-mono">{commit.shortHash}</span>
                  <span className="truncate">{commit.author}</span>
                  <span className="ml-auto shrink-0">{relativeTime(commit.date)}</span>
                </div>
                {refs.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {refs.map((ref) => (
                      <span key={ref} className="rounded bg-raised px-1.5 py-px text-[10px] text-sky-400">
                        {ref}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {open && (
                <div className="pb-1">
                  {changed === undefined ? (
                    <p className="py-1 pl-7 text-[11px] text-muted">Loading…</p>
                  ) : typeof changed === 'string' ? (
                    <p className="py-1 pr-3 pl-7 text-[11px] text-danger select-text">{changed}</p>
                  ) : changed.length === 0 ? (
                    <p className="py-1 pl-7 text-[11px] text-muted">No file changes.</p>
                  ) : (
                    changed.map((change) => {
                      const name = change.path.split('/').pop()!
                      const dir = change.path.slice(0, -name.length - 1)
                      const kind = KIND_STYLE[change.kind]
                      const isSelected = selected?.hash === commit.hash && selected.path === change.path
                      return (
                        <div
                          key={change.path}
                          role="button"
                          tabIndex={0}
                          data-testid="commit-file"
                          title={change.from ? `${change.from} → ${change.path}` : change.path}
                          className={`flex h-6 cursor-pointer items-center gap-2 pr-3 pl-7 text-[13px] ${
                            isSelected ? 'bg-raised text-fg' : 'text-fg/85 hover:bg-raised/60'
                          }`}
                          onClick={() => onSelect(commit, change)}
                          onKeyDown={(e) => e.key === 'Enter' && onSelect(commit, change)}
                        >
                          <span className={`truncate ${change.kind === 'D' ? 'line-through' : ''}`}>{name}</span>
                          <span className="truncate text-[11px] text-muted">{dir}</span>
                          <span
                            className={`ml-auto shrink-0 font-mono text-[11px] ${kind.className}`}
                            title={kind.label}
                          >
                            {change.kind}
                          </span>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
