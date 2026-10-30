import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { FileChange, GitStatus, LineStats } from '@shared/git'
import { KIND_STYLE } from './ChangesPanel'
import { diffExtensions, languageFor } from './DiffView'

/** Sections start collapsed past this many files, so a huge change set opens instantly. */
const COLLAPSE_ABOVE = 30
const UNDO_MS = 10_000

const ipcMessage = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

interface Props {
  root: string
  status: GitStatus
  onOpenFile(path: string): void
  onClose(): void
}

interface Undo {
  path: string
  /** The file's content before the discard. */
  previous: string
}

/**
 * Every uncommitted change in one scrolling view: a section per file with its line counts, its diff,
 * and buttons to discard a hunk or the whole file.
 */
export function ReviewView({ root, status, onOpenFile, onClose }: Props) {
  const [stats, setStats] = useState<Record<string, LineStats>>({})
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    status.changes.length > COLLAPSE_ABOVE ? new Set(status.changes.map((c) => c.path)) : new Set()
  )
  const [undo, setUndo] = useState<Undo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const changes = status.changes

  // Counts follow the files as agents keep editing them.
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      window.api.git.numstat(root).then(
        (s) => live && setStats(s),
        () => {}
      )
    void load()
    const off = window.api.files.onChanged((r) => {
      if (r !== root) return
      clearTimeout(timer)
      timer = setTimeout(load, 300)
    })
    return () => {
      live = false
      clearTimeout(timer)
      off()
    }
  }, [root, changes.length])

  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [undo])

  const toggle = (path: string) =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const discardFile = async (change: FileChange) => {
    const what =
      change.kind === 'A'
        ? `Move the new file ${change.path} to the Trash?`
        : `Discard all changes to ${change.path}? They can't be recovered.`
    if (!confirm(what)) return
    try {
      await window.api.git.discard(root, change)
      setError(null)
    } catch (e) {
      setError(ipcMessage(e))
    }
  }

  const undoDiscard = async () => {
    if (!undo) return
    setUndo(null)
    await window.api.files.write(root, undo.path, undo.previous).catch((e) => setError(ipcMessage(e)))
  }

  const total = changes.reduce(
    (sum, c) => ({ added: sum.added + (stats[c.path]?.added ?? 0), removed: sum.removed + (stats[c.path]?.removed ?? 0) }),
    { added: 0, removed: 0 }
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="review-view">
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-line bg-panel px-3 text-xs">
        <span className="font-medium">Review</span>
        <span className="text-muted">
          {changes.length} file{changes.length === 1 ? '' : 's'} · <span className="text-emerald-400">+{total.added}</span>{' '}
          <span className="text-danger">−{total.removed}</span>
        </span>
        <button
          className="ml-auto text-muted hover:text-fg"
          onClick={() => setCollapsed(collapsed.size === changes.length ? new Set() : new Set(changes.map((c) => c.path)))}
        >
          {collapsed.size === changes.length ? 'Expand all' : 'Collapse all'}
        </button>
        <button className="text-muted hover:text-fg" onClick={onClose} aria-label="Close review">
          ✕
        </button>
      </div>
      {error && <p className="border-b border-line px-3 py-1.5 text-[11px] text-danger select-text">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {changes.length === 0 ? (
          <p className="p-3 text-xs text-muted">No changes to review.</p>
        ) : (
          changes.map((change) => (
            <ReviewFile
              key={change.path}
              root={root}
              change={change}
              stats={stats[change.path]}
              collapsed={collapsed.has(change.path)}
              onToggle={() => toggle(change.path)}
              onOpen={() => onOpenFile(change.path)}
              onDiscardFile={() => void discardFile(change)}
              onDiscardedHunk={(previous) => setUndo({ path: change.path, previous })}
              onError={setError}
            />
          ))
        )}
      </div>
      {undo && (
        <div className="absolute right-4 bottom-4 flex items-center gap-3 rounded-md border border-line bg-panel px-3 py-2 text-xs shadow-xl">
          <span>Discarded a change in {undo.path.split('/').pop()}</span>
          <button className="font-medium text-accent hover:underline" data-testid="undo-discard" onClick={() => void undoDiscard()}>
            Undo
          </button>
        </div>
      )}
    </div>
  )
}

function ReviewFile(props: {
  root: string
  change: FileChange
  stats: LineStats | undefined
  collapsed: boolean
  onToggle(): void
  onOpen(): void
  onDiscardFile(): void
  onDiscardedHunk(previous: string): void
  onError(message: string): void
}) {
  const { root, change, stats, collapsed } = props
  const hostRef = useRef<HTMLDivElement>(null)
  // Editors are built once a section comes near the viewport, so dozens of files stay cheap.
  const [near, setNear] = useState(false)
  const callbacks = useRef(props)
  callbacks.current = props

  useEffect(() => {
    if (collapsed || near) return
    const host = hostRef.current!
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      rootMargin: '400px'
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [collapsed, near])

  useEffect(() => {
    if (collapsed || !near) return
    let view: EditorView | null = null
    let cancelled = false
    const render = async () => {
      try {
        const [{ original, modified }, lang] = await Promise.all([
          window.api.git.diff(root, change.path, change.from),
          languageFor(change.path)
        ])
        if (cancelled) return
        view?.destroy()
        view = new EditorView({
          parent: hostRef.current!,
          state: reviewState(modified, original, lang, async (before, after) => {
            try {
              await window.api.files.write(root, change.path, after)
              callbacks.current.onDiscardedHunk(before)
            } catch (e) {
              callbacks.current.onError(ipcMessage(e))
            }
          })
        })
      } catch (e) {
        if (!cancelled) callbacks.current.onError(ipcMessage(e))
      }
    }
    void render()
    const off = window.api.files.onChanged((r, paths) => {
      if (r === root && paths.includes(change.path)) void render()
    })
    return () => {
      cancelled = true
      off()
      view?.destroy()
    }
  }, [root, change.path, change.from, collapsed, near])

  const name = change.path.split('/').pop()!
  const dir = change.path.slice(0, -name.length - 1)
  const kind = KIND_STYLE[change.kind]
  return (
    <section className="border-b border-line" data-testid="review-file" data-path={change.path}>
      <div className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-line bg-panel px-3 text-xs">
        <button className="w-3 text-[10px] text-muted" aria-label={collapsed ? 'Expand' : 'Collapse'} onClick={props.onToggle}>
          {collapsed ? '▸' : '▾'}
        </button>
        <span className={`font-mono text-[11px] ${kind.className}`} title={kind.label}>
          {change.kind}
        </span>
        <span className={`truncate font-medium ${change.kind === 'D' ? 'line-through' : ''}`}>{name}</span>
        <span className="truncate text-muted">{change.from ? `${change.from} → ` : ''}{dir}</span>
        <span className="shrink-0 font-mono text-[11px]" data-testid="review-stats">
          {stats === undefined ? (
            ''
          ) : stats.added === null ? (
            <span className="text-muted">binary</span>
          ) : (
            <>
              <span className="text-emerald-400">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span>
            </>
          )}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {change.kind !== 'D' && (
            <button className="rounded px-2 py-0.5 text-muted hover:bg-raised hover:text-fg" onClick={props.onOpen}>
              Open
            </button>
          )}
          {change.kind !== 'C' && (
            <button
              className="rounded px-2 py-0.5 text-muted hover:bg-raised hover:text-danger"
              data-testid="discard-file"
              onClick={props.onDiscardFile}
            >
              Discard file
            </button>
          )}
        </div>
      </div>
      {!collapsed && <div ref={hostRef} className="min-h-12 [&>.cm-editor]:max-h-none" />}
    </section>
  )
}

/**
 * The diff of one file, with a Discard button on each changed hunk. Discarding puts the hunk back to its
 * committed text in the editor; the new document is then written to disk via `onDiscard`.
 */
function reviewState(
  modified: string,
  original: string,
  lang: Parameters<typeof diffExtensions>[1],
  onDiscard: (before: string, after: string) => void
): EditorState {
  const extensions = [
    ...diffExtensions(original, lang, (type, action) => {
      if (type === 'accept') {
        const none = document.createElement('span')
        none.hidden = true
        return none
      }
      const button = document.createElement('button')
      button.textContent = 'Discard'
      button.dataset.testid = 'discard-hunk'
      button.className = 'cm-discard-hunk'
      button.onmousedown = action
      return button
    }),
    // The editor is read-only, so the only document changes are discarded hunks.
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onDiscard(u.startState.doc.toString(), u.state.doc.toString())
    })
  ]
  return EditorState.create({ doc: modified, extensions })
}
