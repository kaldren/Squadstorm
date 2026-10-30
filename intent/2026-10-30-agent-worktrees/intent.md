# Intent: Run each agent in its own worktree

Author: Kaloyan (owner). Status: Accepted.
Origin: idea (gap analysis against VS Code, 2026-10-30). Issue: none.

## Problem
The point of Squadstorm is running several agents at once, often on separate tasks. But every agent in a workspace runs in the same folder (`apps/ide/src/renderer/src/components/AgentGrid.tsx:108`). Agents on different tasks overwrite each other's files, one agent's half-finished change breaks another agent's build and tests, and I can't tell whose change is whose. Commit stages everything (`git add -A`, `apps/ide/src/main/git.ts:75`), so one agent's work can't ship without the others'. My own process already plans parallel work in separate worktrees (the `[P]` steps in sdlc-loop), but the IDE doesn't support it.

## Proposed outcome
- When I add an agent, I can give it its own copy of the repo (a git worktree on its own branch), so it works without touching the others.
- Each agent's tile shows which branch it is on.
- When an agent's work is done, I can bring it back (merge it, or open a PR) or throw it away along with its worktree.
- Agents that should collaborate on the same change can still share the workspace folder, as today.

## Affected users and systems
Anyone running more than one agent per workspace. Squadstorm IDE: adding agents, agent tiles, workspace state, git integration. The user's repos (new branches and worktrees).

## Constraints
- Works for every provider (Claude, Codex, Terminal), not just CLIs with their own worktree flag.
- Never deletes uncommitted work without asking.
- Existing workspaces and saved state keep working unchanged.
- Worktrees must not show up as noise in the main workspace's file tree, search or Changes.

## Out of scope
- Containers or sandboxes for agents.
- Automatic merging or conflict resolution between agents.
- PR status and checks in the IDE (a later item).

## Success criteria
- Two agents in their own worktrees can edit the same file differently without affecting each other or the main folder.
- Each isolated agent's tile shows its branch.
- Removing an isolated agent with uncommitted changes asks before anything is lost.
- An isolated agent's work can be brought back to the main branch from the IDE.
- An e2e test covers creating an isolated agent and getting its work back.
- Agents and state from before this change still load and run.

## Open questions
- Should a worktree be opt-in per agent, or the default for agents in a git repo?
- Where should worktrees live (outside the repo?), and how are branches named?
- What happens to the worktree and branch when the agent is removed: keep, ask, delete?
- Does work come back by local merge, by PR through `gh`, or both?
- Should starting an isolated agent let me give it a task prompt right away?
- How does the Changes/History view show an isolated agent's work (ties into the review-changes intent)?
