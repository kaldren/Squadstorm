import { useEffect, useRef, useState } from 'react'
import { nameError, nameSlug, slug } from '@shared/worktrees'

// ipcMain.handle rejections arrive wrapped as "Error invoking remote method 'x': Error: …".
const ipcMessage = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * Asks for an optional branch name for a new isolated agent. Enter adds it (blank: automatic name),
 * Escape or a click outside cancels. A name that can't be used stays in the field with the reason.
 */
export function BranchNamePrompt({
  root,
  nextLabel,
  onAdd,
  onClose
}: {
  /** The workspace folder, where the name is checked. */
  root: string
  /** The label the new agent will get, for the automatic name's preview. */
  nextLabel: string
  onAdd(name: string | undefined): void
  onClose(): void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    const close = (e: MouseEvent) => {
      // The + button that opened it sits next to it, in the same wrapper; it toggles the prompt itself.
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', close, true)
    return () => {
      live.current = false
      window.removeEventListener('mousedown', close, true)
    }
  }, [onClose])

  const submit = async () => {
    if (checking) return
    const problem = nameError(text)
    if (problem) return setError(problem)
    if (!text.trim()) return onAdd(undefined)
    setChecking(true)
    try {
      const taken = await window.api.worktrees.checkName(root, text)
      if (!live.current) return
      if (taken) setError(taken)
      else onAdd(text.trim())
    } catch (e) {
      if (live.current) setError(ipcMessage(e))
    } finally {
      if (live.current) setChecking(false)
    }
  }

  const typed = nameSlug(text)

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Name the agent's branch"
      className="absolute top-8 right-0 z-30 w-72 rounded-md border border-line bg-panel px-3 py-2 text-xs shadow-xl"
    >
      <input
        autoFocus
        data-testid="branch-name"
        aria-label="Branch name"
        placeholder="automatic"
        spellCheck={false}
        // The name is checked as it was when Enter was pressed; don't let it change underneath.
        readOnly={checking}
        className="w-full rounded border border-line bg-raised px-2 py-1 text-fg outline-none focus:border-accent"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <div className="mt-1.5 truncate font-mono text-[11px] text-muted" data-testid="branch-name-preview">
        {!text.trim() ? `squadstorm/${slug(nextLabel)}-… (automatic)` : typed ? `squadstorm/${typed}` : 'Use letters or digits.'}
      </div>
      {error && (
        <div role="alert" data-testid="branch-name-error" className="mt-1 text-[11px] text-danger">
          {error}
        </div>
      )}
      <div className="mt-1 text-[11px] text-muted/70">Enter to add · Esc to cancel</div>
    </div>
  )
}
