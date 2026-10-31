# Intent: Name an agent's worktree branch

Author: Kaloyan (owner). Status: Accepted.
Origin: idea (2026-10-31). Issue: none.

## Problem
With **Own worktree** on, every new agent gets an automatically named branch like `squadstorm/claude-2-9f3a` (`apps/ide/src/shared/worktrees.ts:13`). That name says nothing about what the agent is working on. When several agents run at once, I can't tell their branches apart in the tiles, the Code view's scope picker, `git branch`, or the PRs they open, without remembering which `claude-N` got which task.

## Proposed outcome
- When I add an agent with Own worktree on, I can optionally type a name for its branch.
- If I leave the name empty, the agent gets an automatic name, as today. Skipping the name is as quick as adding an agent is now.
- The name I chose shows up wherever the branch does today: the tile, the Code view's scope picker, merges and PRs.

## Affected users and systems
Anyone using Own worktree in Squadstorm IDE. Adding agents, worktree creation, the user's repos (branch names).

## Constraints
- Agents without a worktree, Terminal tiles, and existing saved workspaces and worktrees behave as today.
- A name I type must never overwrite or reuse a branch that already exists.
- Merge, Open PR and removal keep working, including the checks that protect unmerged and uncommitted work.

## Out of scope
- The agent choosing or renaming its own branch once it knows its task (possible later).
- Renaming the branch of an agent that already exists.
- Naming shared (non-worktree) agents or terminals.
- Giving the agent a task prompt when it starts.

## Success criteria
- Adding an agent with a typed name puts it on a branch with that name (under `squadstorm/`), and its tile shows it.
- Adding an agent with the name left empty gives it an automatic name, as today.
- A name that is invalid for git, or already taken, is not used and I'm told why.
- Merge, Open PR and removal work for a named branch as for an automatic one.
- Saved state and agents from before this change still load and run.

## Open questions
- Is the name typed into a prompt that appears after clicking + Claude / + Codex, or into a field that's always in the header?
- Does the name keep the `squadstorm/` prefix, or can I type any branch name?
- When the name is taken: refuse it, or add a suffix automatically?
- Should the worktree folder use the same name?
