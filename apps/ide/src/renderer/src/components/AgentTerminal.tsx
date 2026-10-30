import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Terminal, type IDisposable, type ILink } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { ActivityTracker, type Activity } from '@shared/activity'
import { nextWaiting } from '@shared/attention'
import { bracketedPaste, cellRange, findPathLinks, findUrlLinks, logicalLine, quotePath } from '@shared/links'
import { PROVIDERS } from '@shared/providers'
import type { AgentConfig } from '@shared/types'
import { attachPty } from '../ptyBus'
import { openFileIndex } from '../fileIndex'
import { useAttention } from '../stores/attention'
import { useWorkspaces } from '../stores/workspaces'

type Status = 'starting' | 'running' | 'exited' | 'error'

/** A link can span at most this many wrapped rows (keeps matching bounded on huge lines). */
const MAX_WRAPPED_ROWS = 24

const THEME = {
  background: '#0e0f12',
  foreground: '#e6e8ee',
  cursor: '#7c9cff',
  selectionBackground: '#7c9cff44'
}

export interface ReorderHandlers {
  dragging: boolean
  dropTarget: boolean
  onDragStart(): void
  onDragEnd(): void
  /** Returns whether this tile accepts the drag (only agent tiles of the same grid). */
  onDragOver(): boolean
  onDragLeave(): void
  onDrop(): void
}

interface Props {
  agent: AgentConfig
  cwd: string
  workspaceId: string
  /** The workspace folder: where an isolated agent's branch merges back. */
  workspacePath: string
  /** Named in notifications. */
  workspaceName: string
  /** No other agent of the same CLI runs in this tile's folder, so its last session is its own. */
  soleInFolder: boolean
  maximized: boolean
  hidden: boolean
  onMaximize(): void
  onRestore(): void
  onClose(): void
  /** Null while reordering is unavailable (e.g. an agent is maximized). */
  reorder: ReorderHandlers | null
}

export function AgentTerminal({
  agent,
  cwd,
  workspaceId,
  workspacePath,
  workspaceName,
  soleInFolder,
  maximized,
  hidden,
  onMaximize,
  onRestore,
  onClose,
  reorder
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<() => void>(() => {})
  /** Re-reads activity and waiting now instead of at the next poll (e.g. when the tile gets focus). */
  const evaluateRef = useRef<() => void>(() => {})
  const [status, setStatus] = useState<Status>('starting')
  const [activity, setActivity] = useState<Activity>('online')
  const [waiting, setWaiting] = useState(false)
  const [focused, setFocused] = useState(false)
  const provider = PROVIDERS[agent.provider]
  // Notification text uses the latest names without restarting the terminal.
  const namesRef = useRef({ label: agent.label, workspaceName })
  namesRef.current = { label: agent.label, workspaceName }
  // Read when (re)starting, without restarting the terminal when they change.
  const launchRef = useRef({ started: !!agent.started, soleInFolder })
  launchRef.current = { started: !!agent.started, soleInFolder }
  const focusRequest = useAttention((s) => s.focusRequest)

  useEffect(() => {
    const host = hostRef.current!
    const term = new Terminal({
      fontFamily: getComputedStyle(document.body).getPropertyValue('--font-mono'),
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      theme: THEME
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try {
      const webgl = new WebglAddon()
      // Chromium caps live WebGL contexts; fall back to the DOM renderer when one is lost.
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      // WebGL unavailable: the DOM renderer is fine.
    }
    termRef.current = term

    const fitIfVisible = () => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return false
      fit.fit()
      return true
    }
    fitIfVisible()

    // xterm only shows its scrollbar on hover; flag the host so CSS keeps it up whenever there is scrollback.
    const markScrollback = () => {
      host.toggleAttribute('data-scrollback', term.buffer.active.baseY > 0)
    }
    const written = term.onWriteParsed(markScrollback)
    const bufferChange = term.buffer.onBufferChange(markScrollback)

    // Until spawn resolves, live output is already contained in the returned backlog.
    let attached = false
    let tracker = new ActivityTracker(Date.now())

    // You're looking at an agent when the window has focus and so does its tile, which also means
    // its workspace, view and tile are on screen.
    const seen = () => document.hasFocus() && !!rootRef.current?.contains(document.activeElement)
    let prev: Activity = 'online'
    let isWaiting = false
    /** Set by a bell or OSC 9 notification, consumed by the next evaluation. */
    let signal: { kind: 'bell' | 'osc'; text?: string } | null = null
    /** True while the backlog of a running session is replayed into a fresh terminal. */
    let replaying = false

    const evaluate = () => {
      const now = Date.now()
      const next = tracker.status(now)
      const asked = signal
      signal = null
      const nextIsWaiting = nextWaiting({
        shell: !!provider.shell,
        prev,
        activity: next,
        signal: asked?.kind ?? null,
        replaying,
        seen: seen(),
        waiting: isWaiting
      })
      // macOS notifications only while you're away from the window; in it, the tile and sidebar show it.
      if (nextIsWaiting && !isWaiting && !document.hasFocus()) {
        const { label, workspaceName: workspace } = namesRef.current
        window.api.attention.notify({
          agentId: agent.id,
          title: `${label} in ${workspace}`,
          body: asked?.text || 'Finished, or waiting for your input.'
        })
      }
      if (next !== prev || nextIsWaiting !== isWaiting) {
        useAttention.getState().report(agent.id, { activity: next, waiting: nextIsWaiting })
      }
      prev = next
      isWaiting = nextIsWaiting
      setActivity(next)
      setWaiting(nextIsWaiting)
    }
    evaluateRef.current = evaluate

    const bell = term.onBell(() => {
      if (replaying) return
      signal = { kind: 'bell' }
      evaluate()
    })
    // OSC 9 is iTerm2's "post a notification". ConEmu's OSC 9;<n>;… subcommands (progress bars and
    // such) reuse the number and are not requests for attention.
    const osc = term.parser.registerOscHandler(9, (text) => {
      if (!replaying && !/^\d+;/.test(text)) {
        signal = { kind: 'osc', text }
        evaluate()
      }
      return true
    })
    const detach = attachPty(
      agent.id,
      (data) => {
        if (!attached) return
        tracker.output(Date.now())
        term.write(data)
      },
      (code) => {
        setStatus('exited')
        term.write(`\r\n\x1b[90m[${provider.label} exited with code ${code}]\x1b[0m\r\n`)
      }
    )

    const start = async () => {
      attached = false
      setStatus('starting')
      const { started, soleInFolder: sole } = launchRef.current
      const result = await window.api.pty.spawn({
        id: agent.id,
        provider: agent.provider,
        cwd,
        cols: term.cols,
        rows: term.rows,
        // An agent that ran before picks its conversation back up: after a relaunch, and on Restart.
        mode: started ? 'resume' : 'fresh',
        soleInFolder: sole
      })
      if (result.error) {
        setStatus('error')
        term.write(`\x1b[31m${result.error}\x1b[0m\r\n`)
        return
      }
      if (!started) {
        launchRef.current.started = true
        useWorkspaces.getState().markStarted(workspaceId, agent.id)
      }
      if (result.backlog) {
        replaying = true
        term.write(result.backlog, () => {
          replaying = false
        })
      }
      // Each (re)start begins a fresh online window.
      tracker = new ActivityTracker(Date.now())
      prev = 'online'
      useAttention.getState().report(agent.id, { activity: prev, waiting: isWaiting })
      attached = true
      setStatus('running')
    }
    startRef.current = () => {
      term.reset()
      markScrollback()
      void start()
    }
    void start()

    const links = registerLinks(term, agent.id, cwd)

    const input = term.onData((data) => {
      tracker.input(Date.now())
      window.api.pty.write(agent.id, data)
    })
    const resize = term.onResize(({ cols, rows }) => {
      tracker.input(Date.now())
      window.api.pty.resize(agent.id, cols, rows)
      markScrollback()
    })
    // Activity also changes on its own as time passes, so poll rather than only reacting to output.
    const activityTimer = setInterval(evaluate, 500)
    // Fires on grid reflow, sidebar drags, and when a hidden workspace becomes visible again.
    const observer = new ResizeObserver(() => fitIfVisible())
    observer.observe(host)

    return () => {
      observer.disconnect()
      clearInterval(activityTimer)
      input.dispose()
      resize.dispose()
      bell.dispose()
      osc.dispose()
      links.dispose()
      useAttention.getState().remove(agent.id)
      written.dispose()
      bufferChange.dispose()
      detach()
      term.dispose()
      termRef.current = null
    }
  }, [agent.id, agent.provider, cwd, provider.label, provider.shell])

  // A clicked notification asks this tile to take focus once it is on screen.
  useEffect(() => {
    if (focusRequest !== agent.id) return
    useAttention.getState().requestFocus(null)
    requestAnimationFrame(() => termRef.current?.focus())
  }, [focusRequest, agent.id])

  return (
    <div
      ref={rootRef}
      className={`${hidden ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-bg ${
        reorder?.dropTarget
          ? 'border-accent ring-2 ring-accent/40'
          : waiting
            ? 'border-accent ring-1 ring-accent/50'
            : focused
              ? 'border-accent/60'
              : 'border-line'
      } ${reorder?.dragging ? 'opacity-40' : ''}`}
      data-testid="agent-tile"
      data-agent-id={agent.id}
      data-attention={waiting ? 'waiting' : undefined}
      data-focused={focused || undefined}
      onFocus={() => {
        setFocused(true)
        useAttention.setState({ lastFocused: agent.id })
        evaluateRef.current()
      }}
      onBlur={() => setFocused(false)}
      onMouseDown={() => termRef.current?.focus()}
      onDragOver={(e) => {
        // Files from Finder: their paths go into the prompt.
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          return
        }
        if (!reorder?.onDragOver()) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) reorder?.onDragLeave()
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length > 0) {
          e.preventDefault()
          const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)
          if (paths.length > 0) window.api.pty.write(agent.id, bracketedPaste(`${paths.map(quotePath).join(' ')} `))
          termRef.current?.focus()
          return
        }
        if (!reorder) return
        e.preventDefault()
        reorder.onDrop()
      }}
    >
      <div
        className={`flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 text-xs ${
          reorder ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        data-testid="agent-drag-handle"
        title={reorder ? 'Drag to reorder' : undefined}
        draggable={reorder !== null}
        onDragStart={(e) => {
          if (!reorder) return
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', agent.label)
          reorder.onDragStart()
        }}
        onDragEnd={() => reorder?.onDragEnd()}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          if (maximized) onRestore()
          else onMaximize()
        }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: provider.color }} />
        <span className="font-medium">{agent.label}</span>
        {agent.worktree && (
          <span className="truncate font-mono text-[11px] text-muted" title={agent.worktree.path} data-testid="agent-branch">
            {agent.worktree.branch}
          </span>
        )}
        {status !== 'running' ? (
          <StatusPill status={status} />
        ) : waiting ? (
          <WaitingPill />
        ) : (
          <ActivityPill activity={activity} />
        )}
        <div className="ml-auto flex items-center gap-1">
          {agent.worktree && (
            <WorktreeMenu workspaceId={workspaceId} workspacePath={workspacePath} worktree={agent.worktree} label={agent.label} />
          )}
          {(status === 'exited' || status === 'error') && (
            <button
              className="rounded px-2 py-0.5 text-muted hover:bg-raised hover:text-fg"
              onClick={() => startRef.current()}
            >
              Restart
            </button>
          )}
          <WindowButton label={`Restore ${agent.label}`} title="Back to grid" disabled={!maximized} onClick={onRestore}>
            <path d="M4.5 1.5h6v6M1.5 4.5h6v6h-6z" />
          </WindowButton>
          <WindowButton label={`Maximize ${agent.label}`} title="Full screen" disabled={maximized} onClick={onMaximize}>
            <path d="M1.5 1.5h9v9h-9z" />
          </WindowButton>
          <WindowButton
            label={`Remove ${agent.label}`}
            title={`Stop and remove ${agent.label}`}
            danger
            onClick={onClose}
          >
            <path d="M2 2l8 8M10 2l-8 8" />
          </WindowButton>
        </div>
      </div>
      {/* Padding lives on a wrapper: on .xterm itself it exposes the native scrollbar track. */}
      <div className="min-h-0 flex-1 pt-1.5 pl-2">
        <div ref={hostRef} className="h-full w-full" data-testid="agent-terminal" />
      </div>
    </div>
  )
}

/**
 * Makes ⌘-click open relative file paths printed by the agent (when they exist under its folder) in
 * the Code view, at their line, and http(s) URLs in the browser.
 */
function registerLinks(term: Terminal, agentId: string, cwd: string): IDisposable {
  // Paths become links only when they exist in the agent's folder.
  const files = openFileIndex(cwd)

  /** The rows of the logical line through row `y` (1-based), wrapped rows included, capped. */
  const logicalRows = (y: number) => {
    const buffer = term.buffer.active
    let first = y - 1
    while (first > 0 && buffer.getLine(first)?.isWrapped && y - 1 - first < MAX_WRAPPED_ROWS) first--
    let last = y - 1
    while (buffer.getLine(last + 1)?.isWrapped && last - first < MAX_WRAPPED_ROWS) last++
    const rows = []
    for (let i = first; i <= last; i++) {
      const line = buffer.getLine(i)
      if (!line) continue
      const cells = []
      for (let x = 0; x < line.length; x++) {
        const cell = line.getCell(x)
        cells.push({ chars: cell?.getChars() ?? '', width: cell?.getWidth() ?? 1 })
      }
      rows.push({ y: i + 1, cells })
    }
    return rows
  }

  const withMeta = (event: MouseEvent, open: () => void) => event.metaKey && open()

  const provideLinks = (y: number): ILink[] => {
    const { text, positions } = logicalLine(logicalRows(y))
    const link = (start: number, end: number, label: string, activate: () => void): ILink => ({
      range: cellRange(positions, start, end),
      text: label,
      decorations: { pointerCursor: true, underline: true },
      activate: (event) => withMeta(event, activate)
    })
    const paths = findPathLinks(text)
      .filter((l) => files.has(l.path))
      .map((l) =>
        link(l.start, l.end, text.slice(l.start, l.end), () =>
          useWorkspaces.getState().requestOpen({ root: cwd, path: l.path, line: l.line, column: l.column })
        )
      )
    // The window-open handler in main sends http(s) to the browser and opens nothing in the app.
    const urls = findUrlLinks(text).map((l) => link(l.start, l.end, l.url, () => void window.open(l.url)))
    // xterm asks row by row; answer with the links that touch this row.
    return [...paths, ...urls].filter((l) => l.range.start.y <= y && y <= l.range.end.y)
  }

  const provider = term.registerLinkProvider({ provideLinks: (y, callback) => callback(provideLinks(y)) })

  // Terminal text is drawn on a canvas, so e2e tests reach the links of a line through this hook.
  const hooks = ((window as unknown as Record<string, unknown>).__squadstormLinks ??= {}) as Record<string, unknown>
  hooks[agentId] = {
    ready: () => files.has('') !== null,
    find: (text: string) => {
      const buffer = term.buffer.active
      for (let y = 1; y <= buffer.length; y++) {
        if (buffer.getLine(y - 1)?.translateToString(true).includes(text)) return provideLinks(y)
      }
      return []
    }
  }

  return {
    dispose() {
      provider.dispose()
      files.dispose()
      delete hooks[agentId]
    }
  }
}

const ipcMessage = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** The ⋯ menu of an isolated agent: bring its work back, or look at it. */
function WorktreeMenu({
  workspaceId,
  workspacePath,
  worktree,
  label
}: {
  workspaceId: string
  workspacePath: string
  worktree: NonNullable<AgentConfig['worktree']>
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close, true)
    return () => window.removeEventListener('mousedown', close, true)
  }, [open])

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), 6000)
    return () => clearTimeout(timer)
  }, [message])

  const act = async (fn: () => Promise<string>) => {
    setOpen(false)
    setBusy(true)
    try {
      setMessage({ text: await fn(), error: false })
    } catch (e) {
      setMessage({ text: ipcMessage(e), error: true })
    } finally {
      setBusy(false)
    }
  }

  const items: { label: string; testId: string; run(): void }[] = [
    {
      label: `Merge into ${worktree.base}`,
      testId: 'agent-merge',
      run: () =>
        void act(async () => {
          const { commits } = await window.api.worktrees.merge(workspacePath, worktree)
          return `Merged ${commits} commit${commits === 1 ? '' : 's'} from ${label} into ${worktree.base}.`
        })
    },
    {
      label: 'Open PR',
      testId: 'agent-pr',
      run: () => void act(async () => `Opened ${await window.api.worktrees.openPr(workspacePath, worktree)}`)
    },
    {
      label: 'Show code',
      testId: 'agent-show-code',
      run: () => {
        setOpen(false)
        const { setCodeScope, setView } = useWorkspaces.getState()
        setCodeScope(workspaceId, worktree.path)
        setView(workspaceId, 'code')
      }
    },
    {
      label: 'Copy worktree path',
      testId: 'agent-copy-path',
      run: () => void act(async () => (await navigator.clipboard.writeText(worktree.path), `Copied ${worktree.path}`))
    }
  ]

  return (
    <div className="relative" ref={menuRef}>
      <button
        className="flex h-5 w-6 items-center justify-center rounded text-muted hover:bg-raised hover:text-fg disabled:opacity-40"
        title="Worktree actions"
        aria-label={`Worktree actions for ${label}`}
        aria-expanded={open}
        disabled={busy}
        data-testid="agent-menu"
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? '…' : '⋯'}
      </button>
      {open && (
        <div role="menu" className="absolute top-6 right-0 z-30 w-48 rounded-md border border-line bg-panel py-1 shadow-xl">
          {items.map((item) => (
            <button
              key={item.testId}
              role="menuitem"
              data-testid={item.testId}
              className="block w-full px-3 py-1 text-left text-xs hover:bg-raised"
              onClick={item.run}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {message && (
        <div
          role="status"
          data-testid="agent-message"
          className={`absolute top-6 right-0 z-30 w-72 rounded-md border border-line bg-panel px-3 py-2 text-[11px] shadow-xl select-text ${
            message.error ? 'text-danger' : 'text-fg'
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  )
}

function WindowButton({
  label,
  title,
  disabled,
  danger,
  onClick,
  children
}: {
  label: string
  title: string
  disabled?: boolean
  danger?: boolean
  onClick(): void
  children: ReactNode
}) {
  return (
    <button
      className={`flex h-5 w-6 items-center justify-center rounded text-muted enabled:hover:bg-raised disabled:opacity-30 ${
        danger ? 'enabled:hover:text-danger' : 'enabled:hover:text-fg'
      }`}
      title={title}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
        {children}
      </svg>
    </button>
  )
}

function StatusPill({ status }: { status: Status }) {
  const styles: Record<Status, string> = {
    starting: 'text-muted',
    running: 'text-emerald-400',
    exited: 'text-muted',
    error: 'text-danger'
  }
  return <span className={`${styles[status]} text-[11px]`}>{status}</span>
}

function WaitingPill() {
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] font-medium text-accent"
      title="Finished, or waiting for your input"
      data-testid="agent-waiting"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      waiting
    </span>
  )
}

function ActivityPill({ activity }: { activity: Activity }) {
  const dots: Record<Activity, string> = {
    online: 'bg-emerald-400',
    idle: 'bg-orange-400',
    working: 'bg-red-500 animate-pulse'
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted" data-testid="agent-activity" data-activity={activity}>
      <span className={`h-1.5 w-1.5 rounded-full ${dots[activity]}`} />
      {activity}
    </span>
  )
}
