import { useEffect, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { DeepWork } from '../components/DeepWork'
import { WorkspaceSidebar } from '../components/WorkspaceSidebar'
import { WorkspaceView } from '../components/WorkspaceView'
import { useWorkspaces } from '../stores/workspaces'

export function Main() {
  const workspaces = useWorkspaces((s) => s.workspaces)
  const activeId = useWorkspaces((s) => s.activeWorkspaceId)
  const deepWorkOpen = useWorkspaces((s) => s.deepWorkOpen)
  // The player mounts on first open, then stays mounted so music survives leaving the screen.
  const [deepWorkOpened, setDeepWorkOpened] = useState(false)
  if (deepWorkOpen && !deepWorkOpened) setDeepWorkOpened(true)

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

  return (
    <Group orientation="horizontal" className="h-full">
      <Panel id="sidebar" defaultSize={240} minSize={180} maxSize={420}>
        <WorkspaceSidebar />
      </Panel>
      <Separator className="w-px bg-line transition-colors hover:bg-accent data-[separator=active]:bg-accent" />
      <Panel id="agents" minSize={400} className="relative">
        {workspaces.map((w) => (
          <WorkspaceView key={w.id} workspace={w} hidden={w.id !== activeId} />
        ))}
        {deepWorkOpened && <DeepWork hidden={!deepWorkOpen} />}
      </Panel>
    </Group>
  )
}
