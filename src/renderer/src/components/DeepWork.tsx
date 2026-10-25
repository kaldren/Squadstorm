import { useEffect, useRef } from 'react'
import { DEEP_WORK_PARTITION, DEEP_WORK_URL } from '@shared/deepWork'
import { registerPlayer, useDeepWork } from '../stores/deepWork'

export function DeepWork({ hidden }: { hidden: boolean }) {
  const ref = useRef<Electron.WebviewTag>(null)
  const track = useDeepWork((s) => s.track)

  useEffect(() => {
    const webview = ref.current!
    const { setPlaying, setTitle } = useDeepWork.getState()
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onTitle = (e: Electron.PageTitleUpdatedEvent) => setTitle(e.title)
    webview.addEventListener('media-started-playing', onPlay)
    webview.addEventListener('media-paused', onPause)
    webview.addEventListener('page-title-updated', onTitle)
    registerPlayer(webview)
    return () => {
      webview.removeEventListener('media-started-playing', onPlay)
      webview.removeEventListener('media-paused', onPause)
      webview.removeEventListener('page-title-updated', onTitle)
      registerPlayer(null)
      setPlaying(false)
    }
  }, [])

  return (
    // Covers the workspaces rather than replacing them, and stays mounted while hidden so
    // the music keeps playing (a display:none webview misbehaves, so it's made invisible).
    <div
      data-testid="deep-work"
      className={`absolute inset-0 z-10 flex flex-col bg-bg ${hidden ? 'invisible' : ''}`}
    >
      <header className="drag flex h-10 shrink-0 items-center gap-3 border-b border-line px-4">
        <span className="text-sm font-semibold">Deep Work</span>
        <span className="truncate text-xs text-muted">{track ?? 'YouTube Music'}</span>
      </header>
      <webview
        ref={ref}
        src={DEEP_WORK_URL}
        partition={DEEP_WORK_PARTITION}
        // Google's consent and sign-in pages assume a white page behind them.
        className="min-h-0 flex-1 bg-white"
      />
    </div>
  )
}
