import * as pty from 'node-pty'
import { launchArgs, PROVIDERS, PROVIDER_IDS, type LaunchMode, type Provider } from '@shared/providers'
import type { ProviderAvailability, SpawnRequest, SpawnResult } from '@shared/api'
import { resolveCommand, shellPath } from './shell-env'

const BACKLOG_LIMIT = 256 * 1024
/** A resumed agent that exits with an error this soon had no conversation to resume. */
const RESUME_FAILED_MS = 3000
const RESUME_FAILED_NOTE = "\r\n\x1b[90m[Couldn't resume the previous conversation; started a new one]\x1b[0m\r\n"

interface Session {
  proc: pty.IPty
  backlog: string
  alive: boolean
}

type Send = (channel: 'pty:data' | 'pty:exit' | 'pty:session', id: string, payload: string | number) => void

export class PtyManager {
  private sessions = new Map<string, Session>()
  private pending = new Map<string, Promise<SpawnResult>>()

  constructor(private send: Send) {}

  async availability(): Promise<ProviderAvailability> {
    const path = await shellPath()
    const entries = PROVIDER_IDS.map((p) => [p, this.resolve(p, path)])
    return Object.fromEntries(entries) as ProviderAvailability
  }

  private resolve(provider: Provider, path: string): string | null {
    const info = PROVIDERS[provider]
    if (info.shell && process.env.SHELL) return process.env.SHELL
    return resolveCommand(info.command, path)
  }

  /** Idempotent: re-attaching to a live session returns its backlog instead of starting a new process. */
  async spawn(req: SpawnRequest): Promise<SpawnResult> {
    // Serialize per id so a quick remount can't start two processes for one agent.
    const previous = this.pending.get(req.id) ?? Promise.resolve()
    const attempt = previous.catch(() => undefined).then(() => this.spawnOnce(req))
    this.pending.set(req.id, attempt)
    try {
      return await attempt
    } finally {
      if (this.pending.get(req.id) === attempt) this.pending.delete(req.id)
    }
  }

  private async spawnOnce(req: SpawnRequest): Promise<SpawnResult> {
    const existing = this.sessions.get(req.id)
    if (existing?.alive) {
      existing.proc.resize(req.cols, req.rows)
      return { backlog: existing.backlog }
    }
    return this.launch(req, req.mode === 'resume' ? 'resume' : 'fresh')
  }

  private async launch(req: SpawnRequest, requested: LaunchMode, backlog = '', sessionId = req.sessionId): Promise<SpawnResult> {
    const path = await shellPath()
    const provider = PROVIDERS[req.provider]
    const { args: launch, mode } = launchArgs(req.provider, requested, { id: String(sessionId), soleInFolder: req.soleInFolder === true })
    // SQUADSTORM_AGENT_CMD swaps every agent for an arbitrary shell command (used by e2e tests),
    // which still gets the provider's args as "$@".
    const override = process.env.SQUADSTORM_AGENT_CMD
    const file = override ? '/bin/sh' : this.resolve(req.provider, path)
    const args = override ? ['-c', override, 'sh', ...launch] : launch
    if (!file) {
      return { backlog: '', error: `"${provider.command}" was not found on your PATH.` }
    }

    let proc: pty.IPty
    try {
      proc = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: req.cols,
        rows: req.rows,
        cwd: req.cwd,
        env: { ...process.env, ...provider.env, PATH: path, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
      })
    } catch (err) {
      return { backlog: '', error: `Failed to start ${provider.label}: ${(err as Error).message}` }
    }

    const session: Session = { proc, backlog, alive: true }
    this.sessions.set(req.id, session)
    const startedAt = Date.now()

    proc.onData((data) => {
      session.backlog = (session.backlog + data).slice(-BACKLOG_LIMIT)
      this.send('pty:data', req.id, data)
    })
    proc.onExit(({ exitCode }) => {
      session.alive = false
      // A killed session has already been replaced or removed; don't report its exit.
      if (this.sessions.get(req.id) !== session) return
      // It couldn't be resumed: start a new conversation in the same tile, once, on a new session id
      // (the old id may still be taken by the conversation that wouldn't resume).
      if (mode === 'resume' && exitCode !== 0 && Date.now() - startedAt < RESUME_FAILED_MS) {
        session.backlog = (session.backlog + RESUME_FAILED_NOTE).slice(-BACKLOG_LIMIT)
        this.send('pty:data', req.id, RESUME_FAILED_NOTE)
        void this.launch(req, 'fresh', session.backlog, req.nextSessionId).then((result) => {
          if (result.error) {
            this.send('pty:data', req.id, `\x1b[31m${result.error}\x1b[0m\r\n`)
            this.send('pty:exit', req.id, exitCode)
          } else this.send('pty:session', req.id, String(req.nextSessionId))
        })
        return
      }
      this.send('pty:exit', req.id, exitCode)
    })

    return { backlog: '' }
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id)
    if (s?.alive) s.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id)
    if (s?.alive && cols > 0 && rows > 0) s.proc.resize(cols, rows)
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    this.sessions.delete(id)
    if (s.alive) s.proc.kill()
  }

  /** Output buffered per live session; only used by e2e tests. */
  backlogs(): Record<string, string> {
    return Object.fromEntries([...this.sessions].map(([id, s]) => [id, s.backlog]))
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
