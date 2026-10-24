import { useState } from 'react'
import { PROVIDERS, PROVIDER_IDS, type Provider } from '@shared/providers'
import type { Mode } from '@shared/types'
import { useWorkspaces } from '../stores/workspaces'

const MAX_PER_PROVIDER = 8

const MODES: { id: Mode; title: string; blurb: string }[] = [
  {
    id: 'vibe',
    title: 'Vibe coding',
    blurb: 'Jump straight in. Spin up a squad of agents and start prompting.'
  },
  {
    id: 'spec',
    title: 'Spec-driven',
    blurb: 'Write the spec first, then let agents build it. Adds a specs/ folder to the project.'
  }
]

export function Setup() {
  const { availability, workspaces, createWorkspace, closeSetup } = useWorkspaces()
  const [step, setStep] = useState<'mode' | 'agents'>('mode')
  const [mode, setMode] = useState<Mode>('vibe')
  const [counts, setCounts] = useState<Record<Provider, number>>({ claude: 1, codex: 0 })
  const [path, setPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const total = PROVIDER_IDS.reduce((sum, p) => sum + counts[p], 0)
  const canCancel = workspaces.length > 0

  const bump = (p: Provider, delta: number) =>
    setCounts((c) => ({ ...c, [p]: Math.min(MAX_PER_PROVIDER, Math.max(0, c[p] + delta)) }))

  const start = async () => {
    if (!path) return
    setBusy(true)
    setError(null)
    try {
      await createWorkspace({ mode, path, counts })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="drag fixed inset-0 z-10 flex items-center justify-center bg-bg/95 backdrop-blur-sm">
      <div className="no-drag w-[560px] rounded-xl border border-line bg-panel p-8 shadow-2xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">
              {step === 'mode' ? 'How do you want to work?' : 'Assemble your agents'}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {step === 'mode'
                ? 'You can run different modes in different workspaces.'
                : 'Each agent gets its own terminal. You can add or remove agents later.'}
            </p>
          </div>
          {canCancel && (
            <button className="text-sm text-muted hover:text-fg" onClick={closeSetup}>
              Cancel
            </button>
          )}
        </div>

        {step === 'mode' ? (
          <div className="grid grid-cols-2 gap-3">
            {MODES.map((m) => (
              <button
                key={m.id}
                data-testid={`mode-${m.id}`}
                className="rounded-lg border border-line bg-raised p-4 text-left transition hover:border-accent"
                onClick={() => {
                  setMode(m.id)
                  setStep('agents')
                }}
              >
                <div className="font-medium">{m.title}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted">{m.blurb}</div>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {PROVIDER_IDS.map((p) => (
                <div
                  key={p}
                  className="flex items-center gap-3 rounded-lg border border-line bg-raised px-4 py-3"
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: PROVIDERS[p].color }} />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{PROVIDERS[p].label}</div>
                    <div className="text-[11px] text-muted">
                      {availability?.[p] ?? (
                        <span className="text-danger">`{PROVIDERS[p].command}` not found on PATH</span>
                      )}
                    </div>
                  </div>
                  <Counter
                    testId={`count-${p}`}
                    value={counts[p]}
                    onDec={() => bump(p, -1)}
                    onInc={() => bump(p, 1)}
                  />
                </div>
              ))}
            </div>

            <div className="mt-5">
              <div className="mb-1.5 text-xs font-medium text-muted">Project folder</div>
              <button
                data-testid="pick-folder"
                className="flex w-full items-center justify-between rounded-lg border border-dashed border-line px-4 py-3 text-left text-sm hover:border-accent"
                onClick={async () => setPath((await window.api.pickFolder()) ?? path)}
              >
                <span className={`truncate ${path ? '' : 'text-muted'}`}>
                  {path ?? 'Choose a folder…'}
                </span>
                <span className="ml-3 shrink-0 text-xs text-accent">Browse</span>
              </button>
            </div>

            {error && <p className="mt-3 text-xs text-danger">{error}</p>}

            <div className="mt-6 flex items-center justify-between">
              <button className="text-sm text-muted hover:text-fg" onClick={() => setStep('mode')}>
                ← Back
              </button>
              <button
                data-testid="start"
                disabled={!path || total === 0 || busy}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg disabled:cursor-not-allowed disabled:opacity-40"
                onClick={start}
              >
                Start {total} agent{total === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Counter(props: { value: number; onDec(): void; onInc(): void; testId: string }) {
  const btn =
    'h-7 w-7 rounded-md border border-line text-sm hover:bg-panel disabled:opacity-30 disabled:hover:bg-transparent'
  return (
    <div className="flex items-center gap-2" data-testid={props.testId}>
      <button className={btn} disabled={props.value === 0} onClick={props.onDec} aria-label="Fewer">
        −
      </button>
      <span className="w-5 text-center text-sm tabular-nums">{props.value}</span>
      <button
        className={btn}
        disabled={props.value === MAX_PER_PROVIDER}
        onClick={props.onInc}
        aria-label="More"
      >
        +
      </button>
    </div>
  )
}
