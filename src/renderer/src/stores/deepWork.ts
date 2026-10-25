import { create } from 'zustand'

interface DeepWorkStore {
  playing: boolean
  /** Current track, taken from the page title; null when nothing is queued. */
  track: string | null
  setPlaying(playing: boolean): void
  setTitle(title: string): void
  togglePlayback(): void
}

// The mounted player, so the sidebar can play/pause without opening the screen.
let player: Electron.WebviewTag | null = null
export const registerPlayer = (webview: Electron.WebviewTag | null) => {
  player = webview
}

// YouTube Music titles the page "<track> - YouTube Music" while something is queued; any
// other title (plain "YouTube Music", consent or sign-in pages) means no track.
const trackFromTitle = (title: string) => title.match(/^(.+?)\s+-\s+YouTube Music$/)?.[1] ?? null

export const useDeepWork = create<DeepWorkStore>((set) => ({
  playing: false,
  track: null,
  setPlaying: (playing) => set({ playing }),
  setTitle: (title) => set({ track: trackFromTitle(title) }),
  togglePlayback() {
    // userGesture=true, or Chromium blocks play() as autoplay.
    void player?.executeJavaScript(
      `(() => { const v = document.querySelector('video'); if (v) v.paused ? v.play() : v.pause() })()`,
      true
    )
  }
}))
