import { useState } from 'react'
import { gridDimensions } from '@shared/layout'
import type { Workspace } from '@shared/types'
import { useWorkspaces } from '../stores/workspaces'
import { AgentTerminal } from './AgentTerminal'

export function AgentGrid({ workspace, hidden }: { workspace: Workspace; hidden: boolean }) {
  const removeAgent = useWorkspaces((s) => s.removeAgent)
  const moveAgent = useWorkspaces((s) => s.moveAgent)
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
    // Hidden, not unmounted: agents keep running while the code view is open.
    <div className={`${hidden ? 'hidden' : 'flex'} min-h-0 flex-1 flex-col`}>
      {workspace.agents.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">
          Nothing running. Add an agent or a terminal from the toolbar.
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

