import { useCallback, useEffect, useState } from 'react'
import { commitPathspec, NOT_A_REPO, type ChangeKind, type FileChange, type GitStatus } from '@shared/git'
import { SendIcon } from './SendIcon'

export const KIND_STYLE: Record<ChangeKind, { label: string; className: string }> = {
  M: { label: 'Modified', className: 'text-amber-400' },
  A: { label: 'Added', className: 'text-emerald-400' },
  D: { label: 'Deleted', className: 'text-danger' },
  R: { label: 'Renamed', className: 'text-sky-400' },
  C: { label: 'Conflict', className: 'text-danger' }
}

const cleanError = (e: unknown) =>
  (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * Git status for a folder. Agents commit from their terminals and .git is not watched, so it
 * also refreshes on file changes, on window focus and on a slow timer while visible.
 */
export function useGitStatus(root: string, visible: boolean) {
  // Null until the first answer, so "loading" and "failed" never read as "not a repository".
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      setStatus(await window.api.git.status(root))
      setError(null)
    } catch (e) {
      setError(cleanError(e))
    }
  }, [root])

  useEffect(() => {
    if (!visible) return
    void refresh()
    const offChanged = window.api.files.onChanged((r) => r === root && void refresh())
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    const timer = setInterval(onFocus, 4000)
    return () => {
      offChanged()
      window.removeEventListener('focus', onFocus)
      clearInterval(timer)
    }
  }, [root, visible, refresh])

  return { status: status ?? NOT_A_REPO, loaded: status !== null, error, refresh }
}

interface Props {
  root: string
  status: GitStatus
  loaded: boolean
  /** Why the status could not be read, if it couldn't. */
  statusError: string | null
  refresh(): Promise<void>
  selected: string | null
  onSelect(change: FileChange): void
  /** Files left out of the next commit; everything else is in, new files included. */
  unchecked: ReadonlySet<string>
  onCheck(path: string, checked: boolean): void
  onReview(): void
  onSend(path: string): void
}

export function ChangesPanel({ root, status, loaded, statusError, refresh, selected, onSelect, unchecked, onCheck, onReview, onSend }: Props) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<'commit' | 'push' | 'discard' | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (statusError) {
    return <p className="px-3 py-2 text-xs text-danger select-text">Could not read git status: {statusError}</p>
  }
  if (!loaded) return null
  if (!status.repo) {
    return <p className="px-3 py-2 text-xs text-muted">Not a git repository.</p>
  }

  const act = async (kind: 'commit' | 'push' | 'discard', fn: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    try {
      await fn()
      if (kind === 'commit') setMessage('')
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  const checked = new Set(status.changes.map((c) => c.path).filter((p) => !unchecked.has(p)))
  const partial = checked.size < status.changes.length
  const canCommit = checked.size > 0 && message.trim() !== '' && busy === null
  // With every file checked this is today's commit-all; otherwise only the checked files go in.
  const commit = () =>
    canCommit && act('commit', () => window.api.git.commit(root, message, partial ? commitPathspec(status.changes, checked) : undefined))
  const discard = (change: FileChange) => {
    const what =
      change.kind === 'A'
        ? `Move the new file ${change.path} to the Trash?`
        : `Discard all changes to ${change.path}? They can't be recovered.`
    if (confirm(what)) void act('discard', () => window.api.git.discard(root, change))
  }
  // Pushing makes sense with unpushed commits, or to publish a branch that has no upstream.
  const canPush = status.remote && (status.ahead > 0 || !status.upstream) && busy === null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pb-2 text-xs text-muted">
        <span className="truncate" title="Current branch">
          {status.branch ?? 'detached HEAD'}
        </span>
        {status.ahead > 0 && <span title={`${status.ahead} commit(s) to push`}>↑{status.ahead}</span>}
        {status.behind > 0 && <span title={`${status.behind} commit(s) to pull`}>↓{status.behind}</span>}
        {status.changes.length > 0 && (
          <button
            className="ml-auto shrink-0 rounded px-1.5 text-fg/85 hover:bg-raised hover:text-fg"
            title="Every change in one scrolling view"
            data-testid="review-all"
            onClick={onReview}
          >
            Review all
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {status.changes.length === 0 ? (
          <p className="px-3 text-xs text-muted">No changes.</p>
        ) : (
          status.changes.map((change) => {
            const name = change.path.split('/').pop()
            const dir = change.path.slice(0, -name!.length - 1)
            const kind = KIND_STYLE[change.kind]
            return (
              <div
                key={change.path}
                role="button"
                tabIndex={0}
                data-testid="change-entry"
                title={change.from ? `${change.from} → ${change.path}` : change.path}
                className={`group flex h-6 cursor-pointer items-center gap-2 pr-3 pl-2 text-[13px] ${
                  change.path === selected ? 'bg-raised text-fg' : 'text-fg/85 hover:bg-raised/60'
                }`}
                onClick={() => onSelect(change)}
                onKeyDown={(e) => e.key === 'Enter' && onSelect(change)}
              >
                <input
                  type="checkbox"
                  className="shrink-0 accent-accent"
                  aria-label={`Include ${change.path} in the commit`}
                  data-testid="change-check"
                  checked={!unchecked.has(change.path)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onCheck(change.path, e.target.checked)}
                />
                <span className={`truncate ${change.kind === 'D' ? 'line-through' : ''}`}>{name}</span>
                <span className="truncate text-[11px] text-muted">{dir}</span>
                {change.kind !== 'D' && (
                  <button
                    className="ml-auto hidden shrink-0 rounded px-1 text-[11px] text-muted group-hover:block hover:text-fg"
                    title="Send to an agent"
                    aria-label={`Send ${change.path} to an agent`}
                    data-testid="send-file"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSend(change.path)
                    }}
                  >
                    <SendIcon />
                  </button>
                )}
                {change.kind !== 'C' && (
                  <button
                    className={`${change.kind === 'D' ? 'ml-auto' : ''} hidden shrink-0 rounded px-1 text-[11px] text-muted group-hover:block hover:text-danger`}
                    title={change.kind === 'A' ? 'Move the new file to the Trash' : 'Discard the changes to this file'}
                    aria-label={`Discard ${change.path}`}
                    data-testid="change-discard"
                    onClick={(e) => {
                      e.stopPropagation()
                      discard(change)
                    }}
                  >
                    ↺
                  </button>
                )}
                <span
                  className={`shrink-0 font-mono text-[11px] ml-auto group-hover:ml-0 ${kind.className}`}
                  title={kind.label}
                >
                  {change.kind}
                </span>
              </div>
            )
          })
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-line p-2">
        <textarea
          className="resize-none rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] outline-none placeholder:text-muted focus:border-accent/60"
          rows={2}
          placeholder="Commit message"
          aria-label="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void commit()
            }
          }}
        />
        <div className="flex gap-2">
          <button
            className="flex-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-bg disabled:opacity-40"
            title="Commit the checked files (⌘↵)"
            disabled={!canCommit}
            onClick={() => void commit()}
          >
            {busy === 'commit'
              ? 'Committing…'
              : partial
                ? `Commit ${checked.size} of ${status.changes.length}`
                : `Commit${status.changes.length ? ` ${status.changes.length}` : ''}`}
          </button>
          <button
            className="rounded-md border border-line px-2.5 py-1 text-xs hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent"
            title={status.remote ? (status.upstream ? 'Push to the remote' : 'Publish this branch to origin') : 'No remote configured'}
            disabled={!canPush}
            onClick={() => void act('push', () => window.api.git.push(root))}
          >
            {busy === 'push' ? 'Pushing…' : status.upstream ? `Push${status.ahead ? ` ↑${status.ahead}` : ''}` : 'Publish'}
          </button>
        </div>
        {error && (
          <p className="max-h-24 overflow-y-auto text-[11px] whitespace-pre-wrap text-danger select-text" data-testid="git-error">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
