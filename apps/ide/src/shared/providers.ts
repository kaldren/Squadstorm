export type Provider = 'claude' | 'codex' | 'terminal'

export interface ProviderInfo {
  label: string
  command: string
  args: string[]
  /** Accent color for the tile header dot. */
  color: string
  /** Runs the user's login shell ($SHELL) instead of `command`. */
  shell?: boolean
}

// Adding a provider (gemini, aider…) is a matter of adding an entry here.
export const PROVIDERS: Record<Provider, ProviderInfo> = {
  claude: { label: 'Claude', command: 'claude', args: [], color: '#d97757' },
  codex: { label: 'Codex', command: 'codex', args: [], color: '#10a37f' },
  terminal: { label: 'Terminal', command: 'zsh', args: ['-l'], color: '#8b93a7', shell: true }
}

export const PROVIDER_IDS = Object.keys(PROVIDERS) as Provider[]
