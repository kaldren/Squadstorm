import { type ReactNode, useEffect, useState } from 'react'
import type { GithubRepo, GithubStatus } from '@shared/api'
import { parseRepo, repoFullName } from '@shared/github'
import { PROVIDERS, PROVIDER_IDS, type Provider } from '@shared/providers'
import { useWorkspaces } from '../stores/workspaces'

const MAX_PER_PROVIDER = 8

type Source = 'folder' | 'github'

// ipcMain.handle rejections arrive wrapped as "Error invoking remote method 'x': Error: …".
const ipcMessage = (err: unknown) =>
  (err as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')

export function Setup() {
  const { availability, workspaces, createWorkspace, closeSetup } = useWorkspaces()
  const [counts, setCounts] = useState<Record<Provider, number>>({ claude: 1, codex: 0, terminal: 0 })
  const [source, setSource] = useState<Source>('folder')
  const [path, setPath] = useState<string | null>(null)
  const [repoInput, setRepoInput] = useState('')
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [isolate, setIsolate] = useState(false)
  // Worktrees need git: offered for clones, and for folders that are git repos on a branch.
  const [folderIsRepo, setFolderIsRepo] = useState(false)
  useEffect(() => {
    if (!path) return setFolderIsRepo(false)
    let live = true
    window.api.git.status(path).then(
      (s) => live && setFolderIsRepo(s.repo && s.branch !== null),
      () => live && setFolderIsRepo(false)
    )
    return () => {
      live = false
    }
  }, [path])
  const canIsolate = source === 'github' || folderIsRepo

  const total = PROVIDER_IDS.reduce((sum, p) => sum + counts[p], 0)
  const canCancel = workspaces.length > 0
  const repo = parseRepo(repoInput)
  const hasTarget = source === 'folder' ? path !== null : repo !== null

  const bump = (p: Provider, delta: number) =>
    setCounts((c) => ({ ...c, [p]: Math.min(MAX_PER_PROVIDER, Math.max(0, c[p] + delta)) }))

  const start = async () => {
    if (!hasTarget) return
    setBusy(true)
    setError(null)
    try {
      if (source === 'folder') {
        await createWorkspace({ path: path!, counts, isolate: canIsolate && isolate })
      } else {
        setProgress('Cloning…')
        const unsubscribe = window.api.github.onCloneProgress(setProgress)
        try {
          const clone = await window.api.github.clone(repoInput)
          await createWorkspace({ path: clone.path, counts, repo: repoFullName(repo!), isolate })
        } finally {
          unsubscribe()
        }
      }
    } catch (err) {
      setError(ipcMessage(err))
      setProgress(null)
      setBusy(false)
    }
  }

  return (
    <div className="drag fixed inset-0 z-10 flex items-center justify-center bg-bg/95 backdrop-blur-sm">
      <div className="no-drag w-[560px] rounded-xl border border-line bg-panel p-8 shadow-2xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">Assemble your agents</h1>
            <p className="mt-1 text-sm text-muted">
              Each agent gets its own terminal. Add plain terminals too. You can change these later.
            </p>
          </div>
          {canCancel && (
            <button className="text-sm text-muted hover:text-fg" onClick={closeSetup}>
              Cancel
            </button>
          )}
        </div>

        <div className="space-y-2">
          {PROVIDER_IDS.map((p) => (
            <div
              key={p}
              className="flex items-center gap-3 rounded-lg border border-line bg-raised px-4 py-3"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: PROVIDERS[p].color }}
              />
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
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Project</span>
            <div className="flex rounded-md border border-line p-0.5 text-xs">
              {(['folder', 'github'] as const).map((src) => (
                <button
                  key={src}
                  data-testid={`source-${src}`}
                  disabled={busy}
                  className={`rounded px-2 py-0.5 ${
                    source === src ? 'bg-raised text-fg' : 'text-muted hover:text-fg'
                  }`}
                  onClick={() => setSource(src)}
                >
                  {src === 'folder' ? 'Local folder' : 'GitHub repo'}
                </button>
              ))}
            </div>
          </div>
          {source === 'folder' ? (
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
          ) : (
            <RepoPicker value={repoInput} onChange={setRepoInput} disabled={busy} />
          )}
        </div>

        {canIsolate && (
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="isolate"
              className="mt-0.5 accent-accent"
              checked={isolate}
              disabled={busy}
              onChange={(e) => setIsolate(e.target.checked)}
            />
            <span>
              Give each agent its own worktree
              <span className="block text-[11px] text-muted">
                Each agent works on its own branch in its own folder, so parallel tasks never touch each other.
              </span>
            </span>
          </label>
        )}

        {progress && (
          <p
            data-testid="clone-progress"
            className="mt-3 truncate font-mono text-[11px] text-muted"
          >
            {progress}
          </p>
        )}
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}

        <div className="mt-6 flex items-center justify-end">
          <button
            data-testid="start"
            disabled={!hasTarget || total === 0 || busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg disabled:cursor-not-allowed disabled:opacity-40"
            onClick={start}
          >
            {source === 'github' ? 'Clone & start' : 'Start'} {total} agent
            {total === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RepoPicker(props: { value: string; onChange(v: string): void; disabled: boolean }) {
  const [status, setStatus] = useState<GithubStatus | null>(null)
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const s = await window.api.github.status()
      if (!live) return
      setStatus(s)
      if (!s.user) return
      try {
        const list = await window.api.github.repos()
        if (live) setRepos(list)
      } catch (err) {
        if (live) setLoadError(ipcMessage(err))
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const query = props.value.trim().toLowerCase()
  const shown = (repos ?? []).filter((r) => r.fullName.toLowerCase().includes(query))

  return (
    <div className="rounded-lg border border-line bg-raised">
      <input
        data-testid="repo-input"
        autoFocus
        disabled={props.disabled}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={
          status?.user
            ? 'Search your repos, or paste owner/name or a URL'
            : 'owner/name or https://github.com/owner/name'
        }
        className="w-full rounded-t-lg bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted"
        spellCheck={false}
      />
      <div className="border-t border-line">
        {status === null ? (
          <Hint>Checking GitHub sign-in…</Hint>
        ) : !status.user ? (
          <Hint>
            {status.installed ? (
              <>
                Run <code className="font-mono text-fg">gh auth login</code>
              </>
            ) : (
              <>
                Install the GitHub CLI (<code className="font-mono text-fg">gh</code>) and sign in
              </>
            )}{' '}
            to browse your repos. Public repos, and any your git credentials can reach, clone by
            URL.
          </Hint>
        ) : loadError ? (
          <Hint danger>{loadError}</Hint>
        ) : repos === null ? (
          <Hint>Loading repos for {status.user}…</Hint>
        ) : shown.length === 0 ? (
          <Hint>
            No matching repos
            {parseRepo(props.value) ? ' — will clone it by name.' : '.'}
          </Hint>
        ) : (
          <ul className="max-h-44 overflow-y-auto py-1">
            {shown.map((r) => (
              <li key={r.fullName}>
                <button
                  disabled={props.disabled}
                  className={`flex w-full items-baseline gap-2 px-4 py-1.5 text-left text-sm hover:bg-panel ${
                    r.fullName === props.value ? 'text-accent' : ''
                  }`}
                  onClick={() => props.onChange(r.fullName)}
                >
                  <span className="shrink-0">{r.fullName}</span>
                  {r.private && <span className="shrink-0 text-[10px] text-muted">private</span>}
                  <span className="truncate text-[11px] text-muted">{r.description}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Hint(props: { children: ReactNode; danger?: boolean }) {
  return (
    <p
      className={`px-4 py-2.5 text-[11px] leading-relaxed ${props.danger ? 'text-danger' : 'text-muted'}`}
    >
      {props.children}
    </p>
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
