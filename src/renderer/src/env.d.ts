import type { VibeApi } from '@shared/api'

declare global {
  interface Window {
    api: VibeApi
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<Electron.WebviewTag>, Electron.WebviewTag> & {
        src?: string
        partition?: string
      }
    }
  }
}
