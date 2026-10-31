import { useMemo, useState, type KeyboardEvent } from 'react'
import { bracketedPaste, formatReference } from '@shared/links'
import { PROVIDERS } from '@shared/providers'
import { useAttention } from '../stores/attention'
import { useWorkspaces, workspaceOf, type SendRequest } from '../stores/workspaces'

/**
 * Picks the agent that receives a reference to some code, with an optional note. The reference is
 * pasted into the agent's prompt without submitting it, unless you send with ⌘↵.
 */
export function SendToAgent({ request, onClose }: { request: SendRequest; onClose(): void }) {
  const workspaces = useWorkspaces((s) => s.workspaces)
  const workspace = workspaceOf(workspaces, request.root)
  // Agents first, then plain terminals.
  const targets = useMemo(
    () => [...(workspace?.agents ?? [])].sort((a, b) => Number(!!PROVIDERS[a.provider].shell) - Number(!!PROVIDERS[b.provider].shell)),
    [workspace]
  )
  const lastFocused = useAttention.getState().lastFocused
  const [selected, setSelected] = useState(() => {
    const i = targets.findIndex((t) => t.id === lastFocused && !PROVIDERS[t.provider].shell)
    return i >= 0 ? i : 0
  })
  const [note, setNote] = useState('')
  const reference = formatReference(request.path, request.from, request.to)

  const send = (submit: boolean) => {
    const target = targets[selected]
    if (!workspace || !target) return
    window.api.pty.write(target.id, bracketedPaste(formatReference(request.path, request.from, request.to, note)))
    // Enter as its own keystroke, after the paste has landed: some CLIs fold a CR that arrives with a
    // paste into the pasted text.
    if (submit) setTimeout(() => window.api.pty.write(target.id, '\r'), 80)
    const { setView } = useWorkspaces.getState()
    setView(workspace.id, 'agents')
    useAttention.getState().requestFocus(target.id)
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const move = (by: number) => {
      e.preventDefault()
      if (targets.length > 0) setSelected((s) => (s + by + targets.length) % targets.length)
    }
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send(e.metaKey || e.ctrlKey)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex justify-center bg-black/30 pt-16" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Send to agent"
        data-testid="send-picker"
        className="flex h-fit w-[460px] max-w-[calc(100%-32px)] flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-3 py-2 text-xs text-muted">
          Send <span className="font-mono text-fg">{reference}</span> to
        </div>
        <div role="listbox" className="py-1">
          {targets.length === 0 ? (
            <p className="px-3 py-1 text-xs text-muted">No agents in this workspace.</p>
          ) : (
            targets.map((t, i) => (
              <div
                key={t.id}
                role="option"
                aria-selected={i === selected}
                data-testid="send-target"
                className={`flex h-7 cursor-pointer items-center gap-2 px-3 text-[13px] ${i === selected ? 'bg-raised' : 'hover:bg-raised/60'}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  setSelected(i)
                }}
                onDoubleClick={() => send(false)}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: PROVIDERS[t.provider].color }} />
                {t.label}
                {t.worktree && <span className="truncate font-mono text-[11px] text-muted">{t.worktree.branch}</span>}
              </div>
            ))
          )}
        </div>
        <input
          autoFocus
          data-testid="send-note"
          placeholder="Add a note (optional)"
          spellCheck={false}
          className="h-9 border-t border-line bg-transparent px-3 text-[13px] outline-none placeholder:text-muted"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
          ↵ insert into the prompt · ⌘↵ insert and submit · esc cancel
        </div>
      </div>
    </div>
  )
}
