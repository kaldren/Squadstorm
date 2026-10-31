import { create } from 'zustand'
import type { AgentAttention } from '@shared/attention'

interface AttentionStore {
  /** Latest activity and waiting state of every running tile, by agent id. */
  agents: Record<string, AgentAttention>
  /** An agent whose tile should take keyboard focus, e.g. after its notification was clicked. */
  focusRequest: string | null
  /** The tile that had keyboard focus last: the default receiver of code sent to an agent. */
  lastFocused: string | null
  report(agentId: string, state: AgentAttention): void
  remove(agentId: string): void
  requestFocus(agentId: string | null): void
}

export const useAttention = create<AttentionStore>((set, get) => ({
  agents: {},
  focusRequest: null,
  lastFocused: null,
  report: (agentId, state) => set({ agents: { ...get().agents, [agentId]: state } }),
  remove(agentId) {
    const { [agentId]: _gone, ...rest } = get().agents
    set({ agents: rest })
  },
  requestFocus: (agentId) => set({ focusRequest: agentId })
}))

const waitingCount = (agents: Record<string, AgentAttention>) =>
  Object.values(agents).filter((a) => a.waiting).length
const workingCount = (agents: Record<string, AgentAttention>) =>
  Object.values(agents).filter((a) => a.activity === 'working').length

// The dock badge follows the number of waiting agents; main hears how many work, for the quit guard.
useAttention.subscribe((state, prev) => {
  const waiting = waitingCount(state.agents)
  if (waiting !== waitingCount(prev.agents)) window.api.attention.badge(waiting)
  const working = workingCount(state.agents)
  if (working !== workingCount(prev.agents)) window.api.attention.working(working)
})
