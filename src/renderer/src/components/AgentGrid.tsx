import { useState } from 'react'
import { gridDimensions } from '@shared/layout'
import { PROVIDERS, PROVIDER_IDS } from '@shared/providers'
import type { Workspace } from '@shared/types'
import { useWorkspaces } from '../stores/workspaces'
import { AgentTerminal } from './AgentTerminal'

export function AgentGrid({ workspace, hidden }: { workspace: Workspace; hidden: boolean }) {
  const addAgent = useWorkspaces((s) => s.addAgent)
  const removeAgent = useWorkspaces((s) => s.removeAgent)
  const moveAgent = useWorkspaces((s) => s.moveAgent)
  const availability = useWorkspaces((s) => s.availability)
  const [maximizedId, setMaximizedId] = useState<string | null>(null)
  // Derived, so removing the maximized agent drops back to the grid on its own.
  const maximized = workspace.agents.some((a) => a.id === maximizedId) ? maximizedId : null
  const { cols, rows } = maximized ? { cols: 1, rows: 1 } : gridDimensions(workspace.agents.length)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const endDrag = () => {
    setDraggingId(null)
    setDropTargetId(null)
  }

  return (
    // Hidden, not unmounted: background workspaces keep their terminals attached.
    <div className={`${hidden ? 'hidden' : 'flex'} h-full flex-col`}>
      <header className="drag flex h-10 shrink-0 items-center gap-3 border-b border-line px-4">
        <span className="text-sm font-semibold">{workspace.name}</span>
        <span className="truncate text-xs text-muted" title={workspace.path}>
          {workspace.path}
        </span>
        <div className="no-drag ml-auto flex items-center gap-2">
          {PROVIDER_IDS.map((p) => (
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
        </div>
      </header>

      {workspace.agents.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">
          No agents running. Add one from the toolbar.
        </div>
      ) : (
        <div
          className="grid min-h-0 flex-1 gap-2 p-2"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
          }}
        >
          {workspace.agents.map((agent, index) => (
            <AgentTerminal
              key={agent.id}
              agent={agent}
              cwd={workspace.path}
              // Other tiles are hidden rather than unmounted so their terminals keep running.
              maximized={agent.id === maximized}
              hidden={maximized !== null && agent.id !== maximized}
              onMaximize={() => setMaximizedId(agent.id)}
              onRestore={() => setMaximizedId(null)}
              onClose={() => removeAgent(workspace.id, agent.id)}
              // Reordering moves the existing DOM nodes, so terminals and their ptys survive it.
              reorder={
                maximized
                  ? null
                  : {
                      dragging: agent.id === draggingId,
                      dropTarget: draggingId !== null && agent.id === dropTargetId && agent.id !== draggingId,
                      onDragStart: () => setDraggingId(agent.id),
                      onDragEnd: endDrag,
                      onDragOver: () => {
                        if (draggingId === null) return false
                        setDropTargetId(agent.id)
                        return true
                      },
                      onDragLeave: () => setDropTargetId((id) => (id === agent.id ? null : id)),
                      onDrop: () => {
                        if (draggingId !== null) moveAgent(workspace.id, draggingId, index)
                        endDrag()
                      }
                    }
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

