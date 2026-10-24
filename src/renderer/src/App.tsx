import { useEffect } from 'react'
import { Main } from './screens/Main'
import { Setup } from './screens/Setup'
import { useWorkspaces } from './stores/workspaces'

export function App() {
  const loaded = useWorkspaces((s) => s.loaded)
  const hasWorkspaces = useWorkspaces((s) => s.workspaces.length > 0)
  const setupOpen = useWorkspaces((s) => s.setupOpen)
  const init = useWorkspaces((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  if (!loaded) return null

  return (
    <>
      {/* Setup overlays Main rather than replacing it, so running terminals stay mounted. */}
      {hasWorkspaces && <Main />}
      {(setupOpen || !hasWorkspaces) && <Setup />}
    </>
  )
}
