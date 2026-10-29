import type { SquadstormApi } from '@shared/api'

declare global {
  interface Window {
    api: SquadstormApi
  }
}
