import type { AgentConfig, Workspace } from './types'

/** The folder an agent works in. */
export const agentFolder = (agent: AgentConfig, workspace: Workspace) => agent.worktree?.path ?? workspace.path

/**
 * Whether an agent's newest session in its folder is surely its own: no other agent of the same CLI
 * works in that folder now, in any workspace, and none ever did (`sharedFolder`, remembered for good,
 * because the other agent's sessions stay in the folder after it's removed).
 */
export function soleInFolder(agent: AgentConfig, workspaces: Workspace[]): boolean {
  if (agent.sharedFolder) return false
  const home = workspaces.find((w) => w.agents.some((a) => a.id === agent.id))
  if (!home) return false
  const folder = agentFolder(agent, home)
  return !workspaces.some((w) => w.agents.some((a) => a.id !== agent.id && a.provider === agent.provider && agentFolder(a, w) === folder))
}

/** Ids of agents that share their folder with another agent of the same CLI and aren't marked yet. */
export function newlySharedAgents(workspaces: Workspace[]): string[] {
  return workspaces.flatMap((w) => w.agents.filter((a) => !a.sharedFolder && !soleInFolder(a, workspaces)).map((a) => a.id))
}
