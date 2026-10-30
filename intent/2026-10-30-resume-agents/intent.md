# Intent: Agents resume their conversations after a restart

Author: Kaloyan (owner). Status: Accepted.
Origin: idea (gap analysis against VS Code, 2026-10-30). Issue: none.

## Problem
Squadstorm brings my workspaces and agents back after a restart, but "with fresh sessions" (`apps/ide/README.md:41`): every agent forgets the conversation it was having. The app restarts more than you'd think, including after every merge to main when the update script installs the new build. Each time, I lose the context of every agent and have to re-explain or dig through `/resume` pickers tile by tile. Worse, quitting with ⌘Q or closing the window kills agents mid-task without asking (`apps/ide/src/main/index.ts:136-145`).

## Proposed outcome
- After a restart, each agent picks up its own conversation where it left off.
- If an agent's conversation can't be resumed, it starts fresh and says so, instead of failing.
- Quitting or closing the window while any agent is working asks me first.

## Affected users and systems
Anyone who restarts Squadstorm with agents open. Squadstorm IDE: agent startup, saved state, quit and window close. The Claude and Codex CLIs' session/resume features.

## Constraints
- Each agent resumes its own conversation, never another agent's, even when several agents of the same CLI share a folder.
- Plain Terminal tiles behave as today.
- Quitting with no agent working stays instant, with no prompt.
- Saved state from before this change still loads.

## Out of scope
- Keeping agents running after the app quits (a background daemon).
- Restoring terminal scrollback from before the restart.
- Reopening editor tabs after a restart (a later item).

## Success criteria
- Restart the app with two Claude agents mid-conversation: each one resumes its own conversation.
- The same works for a Codex agent.
- An agent whose session is gone starts fresh with a visible note.
- ⌘Q while an agent is working shows a confirmation; cancelling keeps everything running.
- e2e tests cover resume (with a stub CLI) and the quit confirmation.

## Open questions
- Claude Code supports `--session-id <uuid>` and `--resume <id>` (checked on 2.1.314), and agent ids are already UUIDs. Is using the agent id as the session id the right approach?
- Codex has `codex resume <id>` and `--last` (checked on 0.166). How do we learn each Codex agent's session id when several share a folder, or do we rely on per-agent worktrees?
- What should the tile's Restart button do: resume, or start fresh?
- Does closing the window (not quitting) need the same confirmation?
