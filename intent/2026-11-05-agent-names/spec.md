# Spec: Rename agents and terminals

From: intent/2026-11-05-agent-names/intent.md. Status: Accepted.
Standards applied: AGENTS.md, apps/ide/CLAUDE.md, sdlc-loop skill.

## Requirements
1. R1: I can rename any tile (Claude, Codex or Terminal) from its header. (Intent outcome 1; success criterion 4.)
2. R2: Renaming never restarts, interrupts or disconnects what runs in the tile. (Intent constraint 1; success criterion 1.)
3. R3: The new name shows everywhere the tile's name shows today: the tile header, the maximize/restore/remove buttons, notifications, the worktree remove/merge prompts and errors, the Code view's scope picker, and the Send-to-agent picker. (Intent outcome 2; success criterion 2.)
4. R4: The name is saved with the workspace and comes back after quitting and reopening the app. (Intent outcome 3; success criterion 3.)
5. R5: Clearing the name gives the tile back its automatic name. Names are trimmed; at most 40 characters; two tiles may share a name. (Intent open questions 2, 3, 4.)
6. R6: Tiles I don't rename, new tiles' automatic names, worktree branches and folders, and saved state from before this change behave as today. (Intent constraints 2–4.)

## Acceptance criteria
- AC1 (R1, R2, R4, R6): e2e `e2e/rename.spec.ts › rename a tile, and the name survives a relaunch`:
  - Setup with 1 Claude and 1 Codex, then **+ Terminal**.
  - Double-click `agent-name` on the Claude tile; `agent-name-input` appears holding `Claude 1`, all selected. Type `Google OAuth`, press Enter. The header reads `Google OAuth`.
  - The tile's `data-agent-id` is unchanged, and its pty backlog still holds the output from before the rename and echoes input typed after it (same process, not restarted).
  - Rename the Codex tile to `Billing` and the Terminal to `Logs` the same way.
  - Relaunch: the three tiles read `Google OAuth`, `Billing`, `Logs`, in their order.
- AC2 (R5): same file, `› escape cancels, an empty name restores the automatic one`:
  - Rename to `Temp`, then double-click again, type `Other`, press Escape: the header still reads `Temp`.
  - Double-click, clear the field, press Enter: the header reads `Claude 1`.
  - Clicking elsewhere while editing saves what was typed (blur saves).
  - The input refuses a 41st character.
- AC3 (R3): same file, `› the new name shows everywhere the old one did`:
  - The Maximize button's accessible name is `Maximize Google OAuth`.
  - With Own worktree on, a renamed isolated agent appears in the Code view's scope picker as `Google OAuth · squadstorm/…`, and its branch name is unchanged by the rename.
  - The Send-to-agent picker lists `Google OAuth`.
  - e2e `e2e/attention.spec.ts › notifies when a background agent finishes` gets a sibling step or test: after renaming, the notification title is `Google OAuth in <workspace>`.
- AC4 (R5, R6): unit tests in `tests/layout.test.ts › agent names`:
  - `displayName({ label: 'Claude 1' })` is `Claude 1`; with `name: 'Google OAuth'` it is `Google OAuth`.
  - `cleanName('  Google   OAuth ')` is `Google OAuth`; `cleanName('   ')` is `undefined`; a 50-character name is cut to 40.
  - `nextAgentLabel` still returns `Claude 3` when `Claude 2` has been renamed (its automatic label is still taken).
- AC5 (R6): every existing e2e and unit test passes with no assertion removed or loosened, including `smoke.spec.ts › … restored on relaunch` (saved state without `name` loads as before) and the existing header double-click maximize, if covered.

## Design
**Data:** `AgentConfig` gets an optional `name?: string`, the name I gave it. `label` stays the automatic name (`Claude 1`) and keeps its current jobs: automatic numbering (`nextAgentLabel`) and the automatic worktree branch name at creation. Saved state from before has no `name`, so it loads unchanged; no migration.

Keeping `label` rather than overwriting it gives R5 for free (clearing the name drops `name`, so `Claude 1` comes back), and numbering doesn't change: renaming `Claude 2` doesn't free up `Claude 2` for the next new agent, so a new tile never takes the automatic name a renamed one would fall back to.

**Shared** (`src/shared/layout.ts`):
- `displayName(agent): string` returns `agent.name ?? agent.label`.
- `cleanName(text): string | undefined` trims, collapses runs of whitespace, cuts to `MAX_NAME = 40`, and returns `undefined` for empty.

**Store** (`src/renderer/src/stores/workspaces.ts`): `renameAgent(workspaceId, agentId, text)` sets `name: cleanName(text)` (removing the key when undefined) through `updateWorkspace`, so the existing persist subscription saves it (R4). Nothing about the pty is touched (R2): `AgentTerminal`'s terminal effect depends on `agent.id`, provider, cwd and shell, not the name, and notification text already reads the latest name through `namesRef`.

**UI** (`src/renderer/src/components/AgentTerminal.tsx`, the tile header):
- The name is `<span data-testid="agent-name" title="Double-click to rename">`.
- Double-clicking it swaps in `<input data-testid="agent-name-input" maxLength={40}>`, prefilled with the current display name, focused and selected. Enter or blur saves via `renameAgent`; Escape cancels. The double-click on the name stops propagation, so it renames instead of maximizing; double-clicking anywhere else on the header still maximizes.
- While editing, the header isn't draggable (so selecting text in the field doesn't start a tile drag), and keystrokes stay in the input (don't reach the terminal).
- Long names truncate with "…" in the header (`truncate` + `min-w-0`), with the full name in the tooltip.

**Every display of the name uses `displayName`** (R3): the tile header and its Restore/Maximize/Remove labels, `namesRef` (notifications), `WorktreeMenu`'s `label` prop, `workspaces.ts` worktree remove/create prompts and errors, `WorkspaceView`'s scope picker, `SendToAgent`, `AgentGrid`'s "Creating a worktree for …", and the drag payload. Places that need the automatic label keep `label`: `nextAgentLabel` and `worktrees.add(path, agent.label, name)`.

## Flagged concerns
- [x] **Double-click on the header already maximizes the tile.** Constraint: intent "how do I start a rename" (open question 1) vs. existing behavior. Proposed: double-clicking the *name* renames; double-clicking anywhere else on the header still maximizes. Alternative: rename from a small pencil button that appears on hover, which leaves double-click alone but adds a control to every header. Or both. **Resolved 2026-11-06: double-click the name (spec accepted).**
- [x] **Save on blur, not only Enter.** Proposed: clicking away keeps what I typed (like Finder and VS Code tabs); only Escape throws it away. Alternative: blur cancels, so only Enter saves. **Resolved 2026-11-06: as proposed (spec accepted).**
- [x] **Renaming doesn't rename the worktree branch.** An agent renamed `Google OAuth` stays on `squadstorm/claude-1-9f3a`. That's what the intent asks (out of scope), but the tile then shows both the new name and the old branch. Proposed: accept; name the branch when adding the agent (the worktree-names feature) if it should match. **Resolved 2026-11-06: as proposed (spec accepted).**

## Risk
Low. One optional field in saved state, added and read; old state has no `name` and loads as today. The main risk is a place that shows the name but keeps reading `label`, which AC3 covers for each place listed, plus a grep for `.label` on agents in the plan. A second risk is the header's existing drag and double-click handlers swallowing or conflicting with the input; AC1 and AC2 exercise it.

## Open questions
From intent.md:
- How to start a rename? **Proposed:** double-click the name. See concern 1. **Resolved 2026-11-06:** double-click the name.
- Clearing the name? **Answered:** returns to the automatic name (R5).
- Duplicate names? **Answered:** allowed (R5).
- Maximum length? **Answered:** 40 characters; long names truncate with "…" in the header (R5).
- Numbering after a rename? **Answered:** a renamed tile keeps its automatic number, so the next new Claude after renaming `Claude 2` is `Claude 3` (Design).

## Changelog
