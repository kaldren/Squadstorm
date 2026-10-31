import { useCallback, useEffect, useState } from 'react'
import { nextAgentLabel } from '@shared/layout'
import { PROVIDERS, PROVIDER_IDS } from '@shared/providers'
import type { Provider } from '@shared/providers'
import type { Workspace } from '@shared/types'
import { isolates, useWorkspaces, type View } from '../stores/workspaces'
import { AgentGrid } from './AgentGrid'
import { BranchNamePrompt } from './BranchNamePrompt'
import { CodeView } from './CodeView'

const VIEWS: { id: View; label: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'code', label: 'Code' }
]

/** Why new agents can't get their own worktree here, or null when they can. */
function useIsolationBlocker(path: string): string | null {
  const [blocker, setBlocker] = useState<string | null>('Checking git…')
  useEffect(() => {
    let live = true
    const check = async () => {
      try {
        const [status, log] = await Promise.all([window.api.git.status(path), window.api.git.log(path)])
        const reason = !status.repo
          ? 'Not a git repository'
          : !status.branch
            ? 'Detached HEAD: check out a branch'
            : log.length === 0
              ? 'No commits yet: commit something first'
              : null
        if (live) setBlocker(reason)
      } catch {
        if (live) setBlocker('Could not read git status')
      }
    }
    void check()
    window.addEventListener('focus', check)
    return () => {
      live = false
      window.removeEventListener('focus', check)
    }
  }, [path])
  return blocker
}

export function WorkspaceView({ workspace, hidden }: { workspace: Workspace; hidden: boolean }) {
  const addAgent = useWorkspaces((s) => s.addAgent)
  const setIsolate = useWorkspaces((s) => s.setIsolate)
  const availability = useWorkspaces((s) => s.availability)
  const view = useWorkspaces((s) => s.views[workspace.id] ?? 'agents')
  const setView = useWorkspaces((s) => s.setView)
  const setCodeScope = useWorkspaces((s) => s.setCodeScope)
  const isolationBlocker = useIsolationBlocker(workspace.path)

  // The provider whose + button is asking for a branch name. Leaving the Agents view or turning
  // Own worktree off drops the question.
  const [naming, setNaming] = useState<Provider | null>(null)
  const closeNaming = useCallback(() => setNaming(null), [])
  useEffect(() => {
    if (view !== 'agents' || !workspace.isolate) setNaming(null)
  }, [view, workspace.isolate])

  // A file to open in this workspace (a path clicked in an agent's output): show the Code view of
  // the folder it was clicked in; that view opens the file.
  const openRoot = useWorkspaces((s) => s.openRequest?.root)
  const ownsOpen =
    openRoot !== undefined && (openRoot === workspace.path || workspace.agents.some((a) => a.worktree?.path === openRoot))
  useEffect(() => {
    if (!ownsOpen || !openRoot) return
    setCodeScope(workspace.id, openRoot)
    setView(workspace.id, 'code')
  }, [ownsOpen, openRoot, workspace.id, setCodeScope, setView])

  // The Code view shows the workspace or one isolated agent's worktree.
  const scopes = [
    { root: workspace.path, label: 'Workspace' },
    ...workspace.agents.flatMap((a) => (a.worktree ? [{ root: a.worktree.path, label: `${a.label} · ${a.worktree.branch}` }] : []))
  ]
  const requested = useWorkspaces((s) => s.codeScope[workspace.id])
  const scope = scopes.some((s) => s.root === requested) ? requested! : workspace.path

  // Each scope's code view mounts on first use, then stays mounted so open files and edits survive
  // switching; one whose agent is gone unmounts.
  const [opened, setOpened] = useState<string[]>([])
  if (view === 'code' && !opened.includes(scope)) setOpened([...opened, scope])
  const mounted = opened.filter((root) => scopes.some((s) => s.root === root))

  return (
    // Hidden, not unmounted: background workspaces keep their terminals attached.
    <div className={`${hidden ? 'hidden' : 'flex'} h-full flex-col`}>
      <header className="drag flex h-10 shrink-0 items-center gap-3 border-b border-line px-4">
        <span className="text-sm font-semibold">{workspace.name}</span>
        <span className="truncate text-xs text-muted" title={workspace.path}>
          {workspace.path}
        </span>
        <div className="no-drag ml-auto flex items-center gap-2">
          {view === 'agents' && (
            <label
              className={`flex items-center gap-1.5 text-xs ${isolationBlocker ? 'text-muted/60' : 'text-muted hover:text-fg'}`}
              title={
                isolationBlocker ??
                'New agents get their own git worktree and branch, so parallel tasks never touch each other. Terminals stay in the workspace folder.'
              }
            >
              <input
                type="checkbox"
                data-testid="isolate-toggle"
                className="accent-accent"
                checked={!!workspace.isolate}
                // Turning it off always works, even when it couldn't be turned on now.
                disabled={isolationBlocker !== null && !workspace.isolate}
                onChange={(e) => setIsolate(workspace.id, e.target.checked)}
              />
              Own worktree
            </label>
          )}
          {view === 'agents' &&
            PROVIDER_IDS.map((p) => (
              <span key={p} className="relative">
                <button
                  className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1 text-xs hover:bg-raised"
                  title={availability?.[p] ? (PROVIDERS[p].shell ? 'Add a terminal' : `Add a ${PROVIDERS[p].label} agent`) : `${PROVIDERS[p].command} not found on PATH`}
                  // An isolated agent first asks for its branch name; everything else is added right away.
                  onClick={() => (isolates(workspace, p) ? setNaming(naming === p ? null : p) : addAgent(workspace.id, p))}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: PROVIDERS[p].color }} />+{' '}
                  {PROVIDERS[p].label}
                </button>
                {naming === p && (
                  <BranchNamePrompt
                    root={workspace.path}
                    nextLabel={nextAgentLabel(workspace.agents, p)}
                    onClose={closeNaming}
                    onAdd={(name) => {
                      setNaming(null)
                      addAgent(workspace.id, p, name)
                    }}
                  />
                )}
              </span>
            ))}
          {view === 'code' && scopes.length > 1 && (
            <select
              data-testid="code-scope"
              aria-label="Show code of"
              className="max-w-64 rounded-md border border-line bg-panel px-1.5 py-1 text-xs text-fg"
              value={scope}
              onChange={(e) => setCodeScope(workspace.id, e.target.value)}
            >
              {scopes.map((s) => (
                <option key={s.root} value={s.root}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          <div className="flex rounded-md border border-line bg-panel p-0.5 text-xs" role="tablist" title="Switch view (⌘E)">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                className={`rounded px-2.5 py-0.5 ${view === v.id ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}
                onClick={() => setView(workspace.id, v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <AgentGrid workspace={workspace} hidden={view !== 'agents'} />
      {mounted.map((root) => (
        <CodeView key={root} root={root} hidden={view !== 'code' || root !== scope} />
      ))}
    </div>
  )
}
