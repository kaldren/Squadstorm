import { Group, Panel, Separator } from 'react-resizable-panels'
import { AgentGrid } from '../components/AgentGrid'
import { WorkspaceSidebar } from '../components/WorkspaceSidebar'
import { useWorkspaces } from '../stores/workspaces'

export function Main() {
  const workspaces = useWorkspaces((s) => s.workspaces)
  const activeId = useWorkspaces((s) => s.activeWorkspaceId)

  return (
    <Group orientation="horizontal" className="h-full">
      <Panel id="sidebar" defaultSize={240} minSize={180} maxSize={420}>
        <WorkspaceSidebar />
      </Panel>
      <Separator className="w-px bg-line transition-colors hover:bg-accent data-[separator=active]:bg-accent" />
      <Panel id="agents" minSize={400}>
        {workspaces.map((w) => (
          <AgentGrid key={w.id} workspace={w} hidden={w.id !== activeId} />
        ))}
      </Panel>
    </Group>
  )
}
