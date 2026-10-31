export type Provider = 'claude' | 'codex' | 'terminal'

/** Whether to start an agent's conversation or pick its previous one back up. */
export type LaunchMode = 'fresh' | 'resume'

export interface SessionContext {
  /** The agent's session id, a UUID (its own id unless its first session couldn't be resumed). */
  id: string
  /** No other agent of the same CLI runs in the same folder. */
  soleInFolder: boolean
}

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
  /**
   * Arguments that start an agent's own conversation, and that resume it after a restart; `resume`
   * is null when the previous conversation can't be told apart from others, so it starts fresh.
   */
  session?: (ctx: SessionContext) => { fresh: string[]; resume: string[] | null }
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
    color: '#d97757',
    // The agent's id names its Claude session, so each tile resumes exactly its own conversation.
    session: ({ id }) => ({ fresh: ['--session-id', id], resume: ['--resume', id] })
  },
  codex: {
    label: 'Codex',
    command: 'codex',
    args: ['--no-alt-screen'],
    color: '#10a37f',
    // Codex can't name a session up front. `resume --last` picks the newest one in the folder, which
    // is this agent's only when no other Codex agent works there.
    session: ({ soleInFolder }) => ({ fresh: [], resume: soleInFolder ? ['resume', '--last'] : null })
  },
  terminal: { label: 'Terminal', command: 'zsh', args: ['-l'], color: '#8b93a7', shell: true }
}

export const PROVIDER_IDS = Object.keys(PROVIDERS) as Provider[]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The arguments an agent CLI starts with: its session arguments first (Codex's `resume` is a
 * subcommand), then the provider's own. Falls back to a fresh start when resuming isn't possible.
 */
export function launchArgs(provider: Provider, mode: LaunchMode, ctx: SessionContext): { args: string[]; mode: LaunchMode } {
  const info = PROVIDERS[provider]
  // Ids come from saved state: anything but a UUID could be read as a flag, so it gets no session.
  const session = UUID.test(ctx.id) ? info.session?.(ctx) : undefined
  if (!session) return { args: info.args, mode: 'fresh' }
  if (mode === 'resume' && session.resume) return { args: [...session.resume, ...info.args], mode: 'resume' }
  return { args: [...session.fresh, ...info.args], mode: 'fresh' }
}
