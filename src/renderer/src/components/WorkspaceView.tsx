import { useState } from 'react'
import { PROVIDERS, PROVIDER_IDS } from '@shared/providers'
import type { Workspace } from '@shared/types'
import { useWorkspaces, type View } from '../stores/workspaces'
import { AgentGrid } from './AgentGrid'
import { CodeView } from './CodeView'

const VIEWS: { id: View; label: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'code', label: 'Code' }
]

export function WorkspaceView({ workspace, hidden }: { workspace: Workspace; hidden: boolean }) {
  const addAgent = useWorkspaces((s) => s.addAgent)
  const availability = useWorkspaces((s) => s.availability)
  const view = useWorkspaces((s) => s.views[workspace.id] ?? 'agents')
  const setView = useWorkspaces((s) => s.setView)
  // The code view mounts on first use, then stays mounted so open files and edits survive switching.
  const [codeOpened, setCodeOpened] = useState(false)
  if (view === 'code' && !codeOpened) setCodeOpened(true)

  return (
    // Hidden, not unmounted: background workspaces keep their terminals attached.
    <div className={`${hidden ? 'hidden' : 'flex'} h-full flex-col`}>
      <header className="drag flex h-10 shrink-0 items-center gap-3 border-b border-line px-4">
        <span className="text-sm font-semibold">{workspace.name}</span>
        <span className="truncate text-xs text-muted" title={workspace.path}>
          {workspace.path}
        </span>
        <div className="no-drag ml-auto flex items-center gap-2">
          {view === 'agents' &&
            PROVIDER_IDS.map((p) => (
              <button
                key={p}
                className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1 text-xs hover:bg-raised"
                title={availability?.[p] ? `Add a ${PROVIDERS[p].label} agent` : `${PROVIDERS[p].command} not found on PATH`}
                onClick={() => addAgent(workspace.id, p)}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: PROVIDERS[p].color }} />+{' '}
                {PROVIDERS[p].label}
              </button>
            ))}
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
      {codeOpened && <CodeView root={workspace.path} hidden={view !== 'code'} />}
    </div>
  )
}
