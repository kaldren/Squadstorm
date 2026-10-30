import type { Activity } from './activity'

/** Something an agent's terminal said to ask for attention: a bell, or an OSC 9 notification. */
export type AttentionSignal = 'bell' | 'osc' | null

export interface AgentAttention {
  activity: Activity
  /** The agent stopped working or asked for attention, and nobody has looked at it since. */
  waiting: boolean
}

/**
 * Whether an agent is waiting for you after its latest activity reading. An agent you're looking
 * at never waits. Otherwise it starts waiting when it asks (bell, OSC 9) or when it stops working;
 * plain terminals only by asking, since their output is routine. Signals replayed from the backlog
 * after a reload already happened, so they don't count.
 */
export function nextWaiting(input: {
  /** A plain Terminal tile rather than an agent CLI. */
  shell: boolean
  prev: Activity
  activity: Activity
  signal: AttentionSignal
  replaying: boolean
  seen: boolean
  waiting: boolean
}): boolean {
  if (input.seen) return false
  if (input.signal && !input.replaying) return true
  if (!input.shell && input.prev === 'working' && input.activity !== 'working') return true
  return input.waiting
}

/** How many of a workspace's agents are working and how many are waiting, for the sidebar. */
export function attentionCounts(
  agentIds: readonly string[],
  agents: Readonly<Record<string, AgentAttention>>
): { working: number; waiting: number } {
  let working = 0
  let waiting = 0
  for (const id of agentIds) {
    const a = agents[id]
    if (!a) continue
    if (a.waiting) waiting++
    else if (a.activity === 'working') working++
  }
  return { working, waiting }
}
