import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { ActivityTracker, type Activity } from '@shared/activity'
import { nextWaiting } from '@shared/attention'
import { PROVIDERS } from '@shared/providers'
import type { AgentConfig } from '@shared/types'
import { attachPty } from '../ptyBus'
import { useAttention } from '../stores/attention'

type Status = 'starting' | 'running' | 'exited' | 'error'

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
  /** Named in notifications. */
  workspaceName: string
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
  workspaceName,
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
      const result = await window.api.pty.spawn({
        id: agent.id,
        provider: agent.provider,
        cwd,
        cols: term.cols,
        rows: term.rows
      })
      if (result.error) {
        setStatus('error')
        term.write(`\x1b[31m${result.error}\x1b[0m\r\n`)
        return
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
        evaluateRef.current()
      }}
      onBlur={() => setFocused(false)}
      onMouseDown={() => termRef.current?.focus()}
      onDragOver={(e) => {
        if (!reorder?.onDragOver()) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) reorder?.onDragLeave()
      }}
      onDrop={(e) => {
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
        {status !== 'running' ? (
          <StatusPill status={status} />
        ) : waiting ? (
          <WaitingPill />
        ) : (
          <ActivityPill activity={activity} />
        )}
        <div className="ml-auto flex items-center gap-1">
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
