import { create } from 'zustand'
import type { ProviderAvailability } from '@shared/api'
import { moveItem, nextAgentLabel } from '@shared/layout'
import { PROVIDERS, PROVIDER_IDS, type Provider } from '@shared/providers'
import type { AgentConfig, AppState, Workspace } from '@shared/types'

export interface NewWorkspace {
  path: string
  counts: Record<Provider, number>
  repo?: string
  /** Give each agent its own worktree. */
  isolate?: boolean
}

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

/**
 * Removes the worktrees of agents that are going away. Asks before discarding uncommitted changes and
 * reports branches kept because they hold commits of their own. Resolves false when the user said no
 * (or something failed), in which case nothing was removed.
 */
async function releaseWorktrees(root: string, agents: AgentConfig[]): Promise<boolean> {
  const isolated = agents.filter((a) => a.worktree)
  if (isolated.length === 0) return true
  try {
    const states = await Promise.all(isolated.map((a) => window.api.worktrees.inspect(root, a.worktree!)))
    const dirty = isolated.filter((_, i) => states[i].changes > 0)
    if (dirty.length > 0) {
      const what = dirty.map((a) => `${a.label} (${plural(states[isolated.indexOf(a)].changes, 'change')})`).join(', ')
      if (!confirm(`Discard uncommitted changes in the worktree of ${what}? This can't be undone.`)) return false
    }
    const kept: string[] = []
    for (const [i, agent] of isolated.entries()) {
      window.api.pty.kill(agent.id)
      const { branchKept } = await window.api.worktrees.remove(root, agent.worktree!, states[i].changes > 0)
      if (branchKept) kept.push(agent.worktree!.branch)
    }
    if (kept.length > 0) alert(`Kept ${kept.join(', ')}: ${kept.length === 1 ? 'it has' : 'they have'} commits that aren't merged yet.`)
    return true
  } catch (e) {
    alert(`Could not remove the worktree: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`)
    return false
  }
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

  /** Creates the worktrees of pending agents one at a time (git locks its worktree list). */
  let queue = Promise.resolve()
  const provision = (workspaceId: string, agentId: string) => {
    setPending(agentId, true)
    queue = queue.then(async () => {
      const workspace = get().workspaces.find((w) => w.id === workspaceId)
      const agent = workspace?.agents.find((a) => a.id === agentId)
      if (!workspace || !agent) return setPending(agentId, false)
      try {
        const worktree = await window.api.worktrees.add(workspace.path, agent.label)
        updateWorkspace(workspaceId, (w) => ({
          ...w,
          agents: w.agents.map((a) => (a.id === agentId ? { ...a, worktree } : a))
        }))
      } catch (e) {
        updateWorkspace(workspaceId, (w) => ({ ...w, agents: w.agents.filter((a) => a.id !== agentId) }))
        alert(`Could not create a worktree for ${agent.label}: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`)
      }
      setPending(agentId, false)
    })
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
      if (!(await releaseWorktrees(target.path, target.agents))) return false
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
      if (!(await releaseWorktrees(workspace.path, [agent]))) return
      window.api.pty.kill(agentId)
      updateWorkspace(workspaceId, (w) => ({
        ...w,
        agents: w.agents.filter((a) => a.id !== agentId)
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
