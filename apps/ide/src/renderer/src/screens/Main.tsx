import { useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { WorkspaceSidebar } from '../components/WorkspaceSidebar'
import { WorkspaceView } from '../components/WorkspaceView'
import { useAttention } from '../stores/attention'
import { useWorkspaces } from '../stores/workspaces'

export function Main() {
  const workspaces = useWorkspaces((s) => s.workspaces)
  const activeId = useWorkspaces((s) => s.activeWorkspaceId)

  // ⌘E (Ctrl+Shift+E elsewhere, since Ctrl+E is end-of-line in terminals) flips the active
  // workspace between agents and code. Capture phase, so it works while a terminal has focus.
  useEffect(() => {
    const mac = navigator.platform.startsWith('Mac')
    const onKeyDown = (e: KeyboardEvent) => {
      const combo = mac ? e.metaKey && !e.ctrlKey && !e.shiftKey : e.ctrlKey && e.shiftKey && !e.metaKey
      if (!combo || e.altKey || e.key.toLowerCase() !== 'e') return
      const { activeWorkspaceId: id, views, setView } = useWorkspaces.getState()
      if (!id) return
      e.preventDefault()
      e.stopPropagation()
      setView(id, views[id] === 'code' ? 'agents' : 'code')
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // A clicked notification shows its agent: its workspace, the Agents view, then its tile.
  useEffect(
    () =>
      window.api.attention.onClicked((agentId) => {
        const { workspaces, setActive, setView } = useWorkspaces.getState()
        const workspace = workspaces.find((w) => w.agents.some((a) => a.id === agentId))
        if (!workspace) return
        setActive(workspace.id)
        setView(workspace.id, 'agents')
        useAttention.getState().requestFocus(agentId)
      }),
    []
  )

  return (
    <Group orientation="horizontal" className="h-full">
      <Panel id="sidebar" defaultSize={240} minSize={180} maxSize={420}>
        <WorkspaceSidebar />
      </Panel>
      <Separator className="w-px bg-line transition-colors hover:bg-accent data-[separator=active]:bg-accent" />
      <Panel id="agents" minSize={400}>
        {workspaces.map((w) => (
          <WorkspaceView key={w.id} workspace={w} hidden={w.id !== activeId} />
        ))}
      </Panel>
    </Group>
  )
}
