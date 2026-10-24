import { create } from 'zustand'
import type { ProviderAvailability } from '@shared/api'
import { moveItem, nextAgentLabel } from '@shared/layout'
import { PROVIDER_IDS, type Provider } from '@shared/providers'
import type { AgentConfig, AppState, Workspace } from '@shared/types'

export interface NewWorkspace {
  path: string
  counts: Record<Provider, number>
  repo?: string
}

/** What a workspace's main area shows: the agent grid, or the files to edit by hand. */
export type View = 'agents' | 'code'

interface WorkspacesStore extends AppState {
  loaded: boolean
  views: Record<string, View>
  setupOpen: boolean
  availability: ProviderAvailability | null
  init(): Promise<void>
  openSetup(): void
  closeSetup(): void
  createWorkspace(input: NewWorkspace): Promise<void>
  removeWorkspace(id: string): void
  setActive(id: string): void
  setView(workspaceId: string, view: View): void
  addAgent(workspaceId: string, provider: Provider): void
  removeAgent(workspaceId: string, agentId: string): void
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

export const useWorkspaces = create<WorkspacesStore>((set, get) => {
  const updateWorkspace = (id: string, fn: (w: Workspace) => Workspace) =>
    set({ workspaces: get().workspaces.map((w) => (w.id === id ? fn(w) : w)) })

  return {
    workspaces: [],
    activeWorkspaceId: null,
    loaded: false,
    views: {},
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

    async createWorkspace({ path, counts, repo }) {
      const workspace: Workspace = {
        id: crypto.randomUUID(),
        name: basename(path),
        path,
        repo,
        agents: buildAgents(counts)
      }
      set({
        workspaces: [...get().workspaces, workspace],
        activeWorkspaceId: workspace.id,
        setupOpen: false
      })
    },

    removeWorkspace(id) {
      const target = get().workspaces.find((w) => w.id === id)
      target?.agents.forEach((a) => window.api.pty.kill(a.id))
      const workspaces = get().workspaces.filter((w) => w.id !== id)
      const activeWorkspaceId =
        get().activeWorkspaceId === id ? (workspaces[0]?.id ?? null) : get().activeWorkspaceId
      set({ workspaces, activeWorkspaceId })
    },

    setActive: (id) => set({ activeWorkspaceId: id }),

    setView: (workspaceId, view) => set({ views: { ...get().views, [workspaceId]: view } }),

    addAgent(workspaceId, provider) {
      updateWorkspace(workspaceId, (w) => ({
        ...w,
        agents: [
          ...w.agents,
          { id: crypto.randomUUID(), provider, label: nextAgentLabel(w.agents, provider) }
        ]
      }))
    },

    removeAgent(workspaceId, agentId) {
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

// Persist only the durable part of the store whenever it changes.
useWorkspaces.subscribe((state, prev) => {
  if (!state.loaded) return
  if (state.workspaces === prev.workspaces && state.activeWorkspaceId === prev.activeWorkspaceId) {
    return
  }
  window.api.state.save({ workspaces: state.workspaces, activeWorkspaceId: state.activeWorkspaceId })
})
