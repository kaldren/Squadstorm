import { useEffect, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { Commit, FileChange } from '@shared/git'
import { ChangesPanel, useGitStatus } from './ChangesPanel'
import type { TextMatch } from '@shared/search'
import { CodeEditor, type Reveal } from './CodeEditor'
import { DiffView } from './DiffView'
import { FileTree } from './FileTree'
import { HistoryPanel } from './HistoryPanel'
import { QuickOpen } from './QuickOpen'
import { ReviewView } from './ReviewView'
import { SendToAgent } from './SendToAgent'
import { useWorkspaces } from '../stores/workspaces'
import { SearchPanel } from './SearchPanel'

const basename = (path: string) => path.split('/').pop() ?? path

export function CodeView({ root, hidden }: { root: string; hidden: boolean }) {
  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set())
  // Files that changed on disk while they had unsaved edits.
  const [conflicts, setConflicts] = useState<ReadonlySet<string>>(new Set())
  const [side, setSide] = useState<'files' | 'search' | 'changes' | 'history'>('files')
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [searchFocus, setSearchFocus] = useState(0)
  const [searchSelected, setSearchSelected] = useState<{ path: string; match: TextMatch } | null>(null)
  // A selected change replaces the editor with its diff until a file or tab is picked.
  // With a commit it is that commit's change to the file, otherwise the uncommitted one.
  const [diff, setDiff] = useState<{ change: FileChange; commit?: Commit } | null>(null)
  const [searching, setSearching] = useState(false)
  // The review of every change replaces the editor, like a diff does, until a file or tab is picked.
  const [reviewing, setReviewing] = useState(false)
  // Files left out of the next commit (kept here so the choice survives switching panels).
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set())
  const git = useGitStatus(root, !hidden)
  const sendRequest = useWorkspaces((s) => (s.sendRequest?.root === root ? s.sendRequest : null))
  const openRequest = useWorkspaces((s) => (s.openRequest?.root === root ? s.openRequest : null))
  const send = (path: string, from?: number, to?: number) => useWorkspaces.getState().requestSend({ root, path, from, to })

  // Forget unticked files that are no longer changed, so a file that changes again starts ticked.
  useEffect(() => {
    setUnchecked((u) => {
      const changed = new Set(git.status.changes.map((c) => c.path))
      const kept = [...u].filter((p) => changed.has(p))
      return kept.length === u.size ? u : new Set(kept)
    })
  }, [git.status.changes])

  // Once a change is committed or reverted, its diff has nothing left to show.
  const diffGone = diff !== null && !diff.commit && !git.status.changes.some((c) => c.path === diff.change.path)
  useEffect(() => {
    if (diffGone) setDiff(null)
  }, [diffGone])

  // Agents edit files while the code view is open; the tree and editor follow along.
  useEffect(() => {
    window.api.files.watch(root)
    return () => window.api.files.unwatch(root)
  }, [root])

  // ⌘P (Ctrl+P elsewhere) finds files by name, ⌘⇧F searches their contents.
  // Capture phase, so they beat the editor's keymap.
  useEffect(() => {
    if (hidden) return
    const mac = navigator.platform.startsWith('Mac')
    const onKeyDown = (e: KeyboardEvent) => {
      const combo = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      if (!combo || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'p' && !e.shiftKey) setSearching(true)
      else if (key === 'f' && e.shiftKey) {
        setSide('search')
        setSearchFocus((n) => n + 1)
      } else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [hidden])

  const open = (path: string, at?: TextMatch) => {
    setDiff(null)
    setReviewing(false)
    setSearchSelected(at ? { path, match: at } : null)
    if (at) setReveal({ path, line: at.line, column: at.column, length: at.length })
    setTabs((t) => (t.includes(path) ? t : [...t, path]))
    setActive(path)
  }

  // A path clicked in an agent's output opens here, at its line.
  useEffect(() => {
    if (!openRequest) return
    useWorkspaces.getState().requestOpen(null)
    const { path, line, column } = openRequest
    open(path, line ? { line, column: Math.max(0, (column ?? 1) - 1), length: 0, before: '', match: '', after: '' } : undefined)
    // Only the request matters: open() is recreated on every render.
  }, [openRequest])

  const close = (path: string) => {
    if (dirty.has(path) && !confirm(`Discard unsaved changes to ${basename(path)}?`)) return
    const index = tabs.indexOf(path)
    const rest = tabs.filter((t) => t !== path)
    setTabs(rest)
    markDirty(path, false)
    markConflict(path, false)
    if (active === path) setActive(rest[Math.min(index, rest.length - 1)] ?? null)
  }

  const toggleIn = (set: ReadonlySet<string>, path: string, on: boolean): ReadonlySet<string> => {
    if (set.has(path) === on) return set
    const next = new Set(set)
    if (on) next.add(path)
    else next.delete(path)
    return next
  }
  const markDirty = (path: string, isDirty: boolean) => setDirty((d) => toggleIn(d, path, isDirty))
  const markConflict = (path: string, conflicted: boolean) => setConflicts((c) => toggleIn(c, path, conflicted))

  return (
    <div className={`${hidden ? 'hidden' : 'flex'} relative min-h-0 flex-1`}>
      {searching && <QuickOpen root={root} onOpen={open} onClose={() => setSearching(false)} />}
      {sendRequest && !hidden && <SendToAgent request={sendRequest} onClose={() => useWorkspaces.getState().requestSend(null)} />}
      <Group orientation="horizontal" className="h-full w-full">
        <Panel id="files" defaultSize={260} minSize={180} maxSize={480}>
          <div className="flex h-full flex-col border-r border-line bg-panel">
            <div className="flex h-8 shrink-0 items-center gap-2.5 px-3 text-[11px] font-semibold uppercase tracking-wide">
              {(['files', 'search', 'changes', 'history'] as const).map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={side === s}
                  className={`uppercase ${side === s ? 'text-fg' : 'text-muted hover:text-fg'}`}
                  onClick={() => {
                    setSide(s)
                    if (s === 'search') setSearchFocus((n) => n + 1)
                  }}
                >
                  {s}
                  {s === 'changes' && git.status.changes.length > 0 && (
                    <span className="ml-1.5 rounded-full bg-raised px-1.5 py-px text-[10px] text-fg">
                      {git.status.changes.length}
                    </span>
                  )}
                </button>
              ))}
              <button
                className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-raised hover:text-fg"
                title="Go to file (⌘P)"
                aria-label="Go to file"
                data-testid="quick-open"
                onClick={() => setSearching(true)}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <path d="M9 1.75H4.25a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V5.5L9 1.75Z" strokeLinejoin="round" />
                  <path d="M9 1.75V5.5h3.75" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            {/* Both stay mounted so the tree keeps its expanded folders. */}
            <div className={side === 'files' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <FileTree root={root} activePath={diff || reviewing ? null : active} onOpen={open} status={git.status} onSend={send} />
            </div>
            <div className={side === 'search' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <SearchPanel
                root={root}
                visible={!hidden && side === 'search'}
                focusSignal={searchFocus}
                selected={diff ? null : searchSelected}
                onOpen={open}
              />
            </div>
            <div className={side === 'changes' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <ChangesPanel
                root={root}
                status={git.status}
                loaded={git.loaded}
                statusError={git.error}
                refresh={git.refresh}
                selected={diff && !diff.commit ? diff.change.path : null}
                onSelect={(change) => {
                  setReviewing(false)
                  setDiff({ change })
                }}
                unchecked={unchecked}
                onCheck={(path, checked) => setUnchecked((u) => toggleIn(u, path, !checked))}
                onSend={send}
                onReview={() => {
                  setDiff(null)
                  setReviewing(true)
                }}
              />
            </div>
            <div className={side === 'history' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <HistoryPanel
                root={root}
                status={git.status}
                visible={!hidden && side === 'history'}
                selected={diff?.commit ? { hash: diff.commit.hash, path: diff.change.path } : null}
                onSelect={(commit, change) => {
                  setReviewing(false)
                  setDiff({ change, commit })
                }}
              />
            </div>
          </div>
        </Panel>
        <Separator className="w-px bg-line transition-colors hover:bg-accent data-[separator=active]:bg-accent" />
        <Panel id="editor" minSize={300}>
          <div className="flex h-full flex-col">
            {tabs.length > 0 && (
              <div className="flex h-8 shrink-0 overflow-x-auto border-b border-line bg-panel text-xs">
                {tabs.map((path) => (
                  <div
                    key={path}
                    role="tab"
                    aria-selected={path === active && !diff && !reviewing}
                    title={path}
                    data-testid="editor-tab"
                    className={`group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-line pr-1.5 pl-3 ${
                      path === active && !diff && !reviewing ? 'bg-bg text-fg' : 'text-muted hover:text-fg'
                    }`}
                    onClick={() => {
                      setDiff(null)
                      setReviewing(false)
                      setActive(path)
                    }}
                    onAuxClick={(e) => e.button === 1 && close(path)}
                  >
                    {basename(path)}
                    <button
                      className="flex h-4 w-4 items-center justify-center rounded hover:bg-raised"
                      aria-label={`Close ${basename(path)}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        close(path)
                      }}
                    >
                      {/* Unsaved files show a dot that turns into the close button on hover; amber when the
                          file also changed on disk. */}
                      {conflicts.has(path) ? (
                        <>
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-amber-400 group-hover:hidden"
                            title="Changed on disk while you had unsaved edits"
                            data-testid="conflict-dot"
                          />
                          <span className="hidden group-hover:inline">✕</span>
                        </>
                      ) : dirty.has(path) ? (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full bg-fg group-hover:hidden" data-testid="dirty-dot" />
                          <span className="hidden group-hover:inline">✕</span>
                        </>
                      ) : (
                        <span className={path === active && !diff && !reviewing ? '' : 'invisible group-hover:visible'}>✕</span>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {reviewing && !diff && (
              <ReviewView root={root} status={git.status} onOpenFile={open} onClose={() => setReviewing(false)} />
            )}
            {diff && (
              <DiffView
                key={`${diff.commit?.hash ?? ''}:${diff.change.path}`}
                root={root}
                change={diff.change}
                commit={diff.commit}
                onOpenFile={open}
                onSend={send}
              />
            )}
            <div className={diff || reviewing ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
              <CodeEditor
                root={root}
                tabs={tabs}
                active={active}
                reveal={reveal}
                onDirty={markDirty}
                onConflict={markConflict}
                onSend={send}
              />
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  )
}
