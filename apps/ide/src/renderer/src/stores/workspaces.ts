import { create } from 'zustand'
import type { ProviderAvailability } from '@shared/api'
import { moveItem, nextAgentLabel } from '@shared/layout'
import { newlySharedAgents } from '@shared/sessions'
import { PROVIDERS, PROVIDER_IDS, type Provider } from '@shared/providers'
import type { AgentConfig, AppState, Workspace } from '@shared/types'

export interface NewWorkspace {
  path: string
  counts: Record<Provider, number>
  repo?: string
  /** Give each agent its own worktree. */
  isolate?: boolean
}

/** A file to show in the Code view of the folder `root` (a workspace or an agent's worktree). */
export interface OpenRequest {
  root: string
  path: string
  /** 1-based. */
  line?: number
  column?: number
}

/** Code to send to an agent: a file, or lines of it, from the Code view of `root`. */
export interface SendRequest {
  root: string
  path: string
  from?: number
  to?: number
}

/** The workspace whose folder, or one of whose agents' worktrees, is `root`. */
export const workspaceOf = (workspaces: Workspace[], root: string) =>
  workspaces.find((w) => w.path === root || w.agents.some((a) => a.worktree?.path === root))

/** What a workspace's main area shows: the agent grid, or the files to edit by hand. */
export type View = 'agents' | 'code'

interface WorkspacesStore extends AppState {
  loaded: boolean
  views: Record<string, View>
  /** Per workspace, the folder the Code view shows: the workspace itself or an agent's worktree. */
  codeScope: Record<string, string>
  /** Agents whose worktree is still being created; they aren't saved until it exists. */
  pendingWorktrees: ReadonlySet<string>
  setupOpen: boolean
  availability: ProviderAvailability | null
  openRequest: OpenRequest | null
  sendRequest: SendRequest | null
  requestOpen(request: OpenRequest | null): void
  requestSend(request: SendRequest | null): void
  init(): Promise<void>
  openSetup(): void
  closeSetup(): void
  createWorkspace(input: NewWorkspace): Promise<void>
  /** Resolves false when the user kept it (e.g. declined discarding uncommitted worktree changes). */
  removeWorkspace(id: string): Promise<boolean>
  setActive(id: string): void
  setView(workspaceId: string, view: View): void
  setCodeScope(workspaceId: string, root: string): void
  setIsolate(workspaceId: string, isolate: boolean): void
  addAgent(workspaceId: string, provider: Provider): void
  removeAgent(workspaceId: string, agentId: string): Promise<void>
  /** Remembers that an agent has run, so the next launch resumes its conversation. */
  markStarted(workspaceId: string, agentId: string): void
  /** Remembers the session an agent resumes from now on. */
  setSessionId(agentId: string, sessionId: string): void
  moveAgent(workspaceId: string, agentId: string, toIndex: number): void
}

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

function buildAgents(counts: Record<Provider, number>): AgentConfig[] {
  const agents: AgentConfig[] = []
  for (const provider of PROVIDER_IDS) {
    for (let i = 0; i < counts[provider]; i++) {
      agents.push({ id: crypto.randomUUID(), provider, label: nextAgentLabel(agents, provider) })
    }
  }
  return agents
}

/** Whether a new agent of this provider gets a worktree in this workspace. Terminals never do. */
const isolates = (workspace: Workspace, provider: Provider) => !!workspace.isolate && !PROVIDERS[provider].shell

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const ipcMessage = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * Removes the worktrees of agents that are going away and resolves to the ids of those that may go:
 * agents without a worktree, agents whose worktree was removed, and agents the user chose to drop
 * although git refused to remove their worktree (its folder and branch then stay on disk). Asks once
 * before discarding uncommitted changes; declining keeps every agent. Reports kept branches.
 */
async function releaseWorktrees(root: string, agents: AgentConfig[]): Promise<Set<string>> {
  const released = new Set(agents.filter((a) => !a.worktree).map((a) => a.id))
  const isolated = agents.filter((a) => a.worktree)
  if (isolated.length === 0) return released
  // A worktree that can't be inspected (its repo is gone, say) counts as clean; removing it decides.
  const changes = await Promise.all(
    isolated.map((a) => window.api.worktrees.inspect(root, a.worktree!).then((s) => s.changes, () => 0))
  )
  const dirty = isolated.filter((_, i) => changes[i] > 0)
  if (dirty.length > 0) {
    const what = dirty.map((a) => `${a.label} (${plural(changes[isolated.indexOf(a)], 'change')})`).join(', ')
    if (!confirm(`Discard uncommitted changes in the worktree of ${what}? This can't be undone.`)) return new Set()
  }
  const kept: string[] = []
  for (const [i, agent] of isolated.entries()) {
    const wt = agent.worktree!
    // Stop the agent first so it can't keep writing into the folder being removed.
    window.api.pty.kill(agent.id)
    try {
      const { branchKept } = await window.api.worktrees.remove(root, wt, changes[i] > 0)
      if (branchKept) kept.push(wt.branch)
      released.add(agent.id)
    } catch (e) {
      const dropAnyway = confirm(
        `Could not remove the worktree of ${agent.label}: ${ipcMessage(e)}\n\n` +
          `Remove it from Squadstorm anyway? Its folder (${wt.path}) and branch ${wt.branch} stay on disk.`
      )
      if (dropAnyway) released.add(agent.id)
    }
  }
  if (kept.length > 0) alert(`Kept ${kept.join(', ')}: ${kept.length === 1 ? 'it has' : 'they have'} commits that aren't merged yet.`)
  return released
}

export const useWorkspaces = create<WorkspacesStore>((set, get) => {
  const updateWorkspace = (id: string, fn: (w: Workspace) => Workspace) =>
    set({ workspaces: get().workspaces.map((w) => (w.id === id ? fn(w) : w)) })

  const setPending = (agentId: string, pending: boolean) => {
    const next = new Set(get().pendingWorktrees)
    if (pending) next.add(agentId)
    else next.delete(agentId)
    set({ pendingWorktrees: next })
  }

  const agentExists = (workspaceId: string, agentId: string) =>
    !!get().workspaces.find((w) => w.id === workspaceId)?.agents.some((a) => a.id === agentId)

  /** Creates the worktrees of pending agents one at a time (git locks its worktree list). */
  let queue = Promise.resolve()
  const provision = (workspaceId: string, agentId: string) => {
    setPending(agentId, true)
    queue = queue
      .then(async () => {
        const workspace = get().workspaces.find((w) => w.id === workspaceId)
        const agent = workspace?.agents.find((a) => a.id === agentId)
        if (!workspace || !agent) return
        try {
          const worktree = await window.api.worktrees.add(workspace.path, agent.label)
          // The agent or its workspace went away meanwhile: don't leave the new worktree behind.
          if (!agentExists(workspaceId, agentId)) {
            await window.api.worktrees.remove(workspace.path, worktree, false).catch(() => {})
            return
          }
          updateWorkspace(workspaceId, (w) => ({
            ...w,
            agents: w.agents.map((a) => (a.id === agentId ? { ...a, worktree } : a))
          }))
        } catch (e) {
          updateWorkspace(workspaceId, (w) => ({ ...w, agents: w.agents.filter((a) => a.id !== agentId) }))
          alert(`Could not create a worktree for ${agent.label}: ${ipcMessage(e)}`)
        }
      })
      // One failure must never stall the agents queued after it.
      .catch(() => {})
      .finally(() => setPending(agentId, false))
  }

  return {
    workspaces: [],
    activeWorkspaceId: null,
    loaded: false,
    views: {},
    codeScope: {},
    pendingWorktrees: new Set(),
    setupOpen: false,
    availability: null,
    openRequest: null,
    sendRequest: null,
    requestOpen: (request) => set({ openRequest: request }),
    requestSend: (request) => set({ sendRequest: request }),

    async init() {
      const [state, availability] = await Promise.all([
        window.api.state.load(),
        window.api.providers()
      ])
      const activeExists = state.workspaces.some((w) => w.id === state.activeWorkspaceId)
      set({
        ...state,
        activeWorkspaceId: activeExists ? state.activeWorkspaceId : (state.workspaces[0]?.id ?? null),
        availability,
        loaded: true
      })
    },

    openSetup: () => set({ setupOpen: true }),
    closeSetup: () => set({ setupOpen: false }),

    async createWorkspace({ path, counts, repo, isolate }) {
      const workspace: Workspace = {
        id: crypto.randomUUID(),
        name: basename(path),
        path,
        repo,
        isolate: isolate || undefined,
        agents: buildAgents(counts)
      }
      set({
        workspaces: [...get().workspaces, workspace],
        activeWorkspaceId: workspace.id,
        setupOpen: false
      })
      for (const agent of workspace.agents) {
        if (isolates(workspace, agent.provider)) provision(workspace.id, agent.id)
      }
    },

    async removeWorkspace(id) {
      const target = get().workspaces.find((w) => w.id === id)
      if (!target) return true
      const released = await releaseWorktrees(target.path, target.agents)
      if (released.size < target.agents.length) {
        // Some agents stay: the workspace stays too, minus the agents whose worktrees are gone.
        const gone = (a: AgentConfig) => !!a.worktree && released.has(a.id)
        updateWorkspace(id, (w) => ({ ...w, agents: w.agents.filter((a) => !gone(a)) }))
        return false
      }
      target.agents.forEach((a) => window.api.pty.kill(a.id))
      const workspaces = get().workspaces.filter((w) => w.id !== id)
      const activeWorkspaceId =
        get().activeWorkspaceId === id ? (workspaces[0]?.id ?? null) : get().activeWorkspaceId
      set({ workspaces, activeWorkspaceId })
      return true
    },

    setActive: (id) => set({ activeWorkspaceId: id }),

    setView: (workspaceId, view) => set({ views: { ...get().views, [workspaceId]: view } }),

    setCodeScope: (workspaceId, root) => set({ codeScope: { ...get().codeScope, [workspaceId]: root } }),

    setIsolate: (workspaceId, isolate) => updateWorkspace(workspaceId, (w) => ({ ...w, isolate: isolate || undefined })),

    addAgent(workspaceId, provider) {
      const agent: AgentConfig = { id: crypto.randomUUID(), provider, label: '' }
      updateWorkspace(workspaceId, (w) => ({
        ...w,
        agents: [...w.agents, { ...agent, label: nextAgentLabel(w.agents, provider) }]
      }))
      const workspace = get().workspaces.find((w) => w.id === workspaceId)
      if (workspace && isolates(workspace, provider)) provision(workspaceId, agent.id)
    },

    async removeAgent(workspaceId, agentId) {
      const workspace = get().workspaces.find((w) => w.id === workspaceId)
      const agent = workspace?.agents.find((a) => a.id === agentId)
      if (!workspace || !agent) return
      if (!(await releaseWorktrees(workspace.path, [agent])).has(agentId)) return
      window.api.pty.kill(agentId)
      updateWorkspace(workspaceId, (w) => ({
        ...w,
        agents: w.agents.filter((a) => a.id !== agentId)
      }))
    },

    setSessionId(agentId, sessionId) {
      set({
        workspaces: get().workspaces.map((w) => ({
          ...w,
          agents: w.agents.map((a) => (a.id === agentId ? { ...a, sessionId } : a))
        }))
      })
    },

    markStarted(workspaceId, agentId) {
      updateWorkspace(workspaceId, (w) => ({
        ...w,
        agents: w.agents.map((a) => (a.id === agentId && !a.started ? { ...a, started: true } : a))
      }))
    },

    moveAgent(workspaceId, agentId, toIndex) {
      updateWorkspace(workspaceId, (w) => {
        const from = w.agents.findIndex((a) => a.id === agentId)
        return from === toIndex ? w : { ...w, agents: moveItem(w.agents, from, toIndex) }
      })
    }
  }
})

// Agents that ever share their folder with another agent of the same CLI are marked for good: from
// then on "the newest session in this folder" may not be theirs.
useWorkspaces.subscribe((state, prev) => {
  if (state.workspaces === prev.workspaces) return
  const shared = new Set(newlySharedAgents(state.workspaces))
  if (shared.size === 0) return
  useWorkspaces.setState({
    workspaces: state.workspaces.map((w) => ({
      ...w,
      agents: w.agents.map((a) => (shared.has(a.id) ? { ...a, sharedFolder: true } : a))
    }))
  })
})

// Persist only the durable part of the store whenever it changes. Agents still waiting for their
// worktree aren't saved: after a restart they would otherwise run in the shared folder.
useWorkspaces.subscribe((state, prev) => {
  if (!state.loaded) return
  if (
    state.workspaces === prev.workspaces &&
    state.activeWorkspaceId === prev.activeWorkspaceId &&
    state.pendingWorktrees === prev.pendingWorktrees
  ) {
    return
  }
  const pending = state.pendingWorktrees
  const workspaces =
    pending.size === 0 ? state.workspaces : state.workspaces.map((w) => ({ ...w, agents: w.agents.filter((a) => !pending.has(a.id)) }))
  window.api.state.save({ workspaces, activeWorkspaceId: state.activeWorkspaceId })
})
