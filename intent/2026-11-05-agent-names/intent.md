# Intent: Rename agents and terminals

Author: Kaloyan (owner). Status: Accepted.
Origin: idea (2026-11-05). Issue: none.

## Problem
Every tile gets an automatic name, like "Claude 1", "Codex 2" or "Terminal 3" (`apps/ide/src/shared/layout.ts:41`), and I can't change it. When several agents run at once, the name says nothing about what each one is working on, so I have to remember that "Claude 1" is the Google OAuth work and "Claude 2" is something else. The same goes for the notifications ("Claude 1 in <workspace>"), the remove/merge prompts, and the Code view's scope picker, which all show that name.

## Proposed outcome
- I can rename any agent or terminal tile, for example "Claude 1" to "Google OAuth".
- The new name shows everywhere the old one did: the tile header, notifications, prompts, and the Code view's scope picker.
- The name is saved: if I quit and reopen the app, a tile I didn't close keeps the name I gave it.

## Affected users and systems
Anyone running more than one agent or terminal in Squadstorm IDE. Tile header, saved state, notifications, worktree prompts, Code view scope picker.

## Constraints
- Renaming never restarts, interrupts or disconnects the agent or terminal; its conversation and session resume are untouched.
- Tiles I don't rename keep their automatic names, and new tiles keep getting automatic names as today.
- Saved state from before this change still loads.
- An agent's worktree branch and folder don't change when I rename it (renaming a branch is out of scope).

## Out of scope
- Renaming the agent's worktree branch (see `intent/2026-10-31-worktree-names`).
- Naming a tile as I add it (it gets an automatic name, then I rename it).
- The agent naming itself from its task.
- Renaming workspaces.

## Success criteria
- I rename "Claude 1" to "Google OAuth" and the tile header shows "Google OAuth" right away, while the agent keeps running.
- Notifications and prompts for that agent use "Google OAuth".
- After quitting and reopening the app, the tile is still called "Google OAuth".
- Renaming works the same for Claude, Codex and Terminal tiles.
- e2e tests cover renaming and the name surviving a restart.

## Open questions
- How do I start a rename: double-click the name in the tile header, a menu item, or both? - Double click the name.
- What happens if I clear the name: go back to the automatic name, or refuse the empty name? - Keep the old one.
- Can two tiles have the same name, or should that be refused?
- Is there a maximum length, or does a long name just get cut off with "…" in the header?
- If I rename "Claude 2" to something else, should the next new Claude still be "Claude 3", or can "Claude 2" be reused?
