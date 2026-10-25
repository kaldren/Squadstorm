import type { VibeApi } from '@shared/api'

declare global {
  interface Window {
    api: VibeApi
  }
}
