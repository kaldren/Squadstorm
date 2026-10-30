import { attentionCounts } from '@shared/attention'
import { DeepWork } from './DeepWork'
import { useAttention } from '../stores/attention'
import { useWorkspaces } from '../stores/workspaces'

export function WorkspaceSidebar() {
  const { workspaces, activeWorkspaceId, setActive, removeWorkspace, openSetup } = useWorkspaces()
  const attention = useAttention((s) => s.agents)

  return (
    <aside className="flex h-full flex-col border-r border-line bg-panel">
      {/* Leaves room for the macOS traffic lights. */}
      <div className="drag flex h-10 shrink-0 items-center justify-end px-3" />
      <div className="flex items-center justify-between px-3 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Workspaces
        </span>
        <button
          className="rounded px-1.5 text-base leading-none text-muted hover:bg-raised hover:text-fg"
          title="New workspace"
          aria-label="New workspace"
          onClick={openSetup}
        >
          +
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2">
        {workspaces.map((w) => {
          const counts = attentionCounts(w.agents.map((a) => a.id), attention)
          return (
            <div
              key={w.id}
              role="button"
              tabIndex={0}
              className={`group mb-0.5 flex cursor-pointer flex-col gap-1 rounded-md px-2.5 py-2 ${
                w.id === activeWorkspaceId ? 'bg-raised' : 'hover:bg-raised/60'
              }`}
              onClick={() => setActive(w.id)}
              onKeyDown={(e) => e.key === 'Enter' && setActive(w.id)}
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{w.name}</span>
                <button
                  className="ml-auto hidden rounded px-1 text-xs text-muted hover:text-danger group-hover:block"
                  title="Close workspace (stops its agents)"
                  aria-label={`Close ${w.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`Close "${w.name}" and stop its ${w.agents.length} agent(s)?`)) {
                      removeWorkspace(w.id)
                    }
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <span className="shrink-0">
                  {w.agents.length} agent{w.agents.length === 1 ? '' : 's'}
                </span>
                {w.repo && (
                  <span className="truncate" title={`Cloned from github.com/${w.repo}`}>
                    · {w.repo}
                  </span>
                )}
              </div>
              {(counts.working > 0 || counts.waiting > 0) && (
                <div className="flex items-center gap-2 text-[11px]" data-testid="workspace-attention">
                  {counts.working > 0 && <span className="text-muted">{counts.working} working</span>}
                  {counts.waiting > 0 && (
                    <span className="font-medium text-accent" title="Finished, or waiting for your input">
                      {counts.waiting} waiting
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      <DeepWork />
    </aside>
  )
}
