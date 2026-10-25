import type { LeyaApi } from '@shared/api'

declare global {
  interface Window {
    api: LeyaApi
  }
}
