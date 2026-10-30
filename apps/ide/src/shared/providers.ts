export type Provider = 'claude' | 'codex' | 'terminal'

export interface ProviderInfo {
  label: string
  command: string
  args: string[]
  /** Extra environment variables for the process. */
  env?: Record<string, string>
  /** Accent color for the tile header dot. */
  color: string
  /** Runs the user's login shell ($SHELL) instead of `command`. */
  shell?: boolean
}

// Adding a provider (gemini, aider…) is a matter of adding an entry here.
// Agents run inline rather than on the alternate screen, so their output lands in the
// terminal's own scrollback and the tile can scroll it.
export const PROVIDERS: Record<Provider, ProviderInfo> = {
  claude: {
    label: 'Claude',
    command: 'claude',
    args: [],
    // Undocumented; Claude Code reads it to stay off the alternate screen.
    env: { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1' },
    color: '#d97757'
  },
  codex: { label: 'Codex', command: 'codex', args: ['--no-alt-screen'], color: '#10a37f' },
  terminal: { label: 'Terminal', command: 'zsh', args: ['-l'], color: '#8b93a7', shell: true }
}

export const PROVIDER_IDS = Object.keys(PROVIDERS) as Provider[]
