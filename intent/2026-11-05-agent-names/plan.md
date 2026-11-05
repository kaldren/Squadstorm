# Plan: Rename agents and terminals

From: intent.md + spec.md in intent/2026-11-05-agent-names/. Status: Accepted.
Written without changing any code.

## Files that change
All paths under `apps/ide/`.
- `src/shared/types.ts` (modified): `AgentConfig.name?: string` with the doc comment "The name the user gave it; shown instead of `label`, which stays the automatic name."
- `src/shared/layout.ts` (modified):
  - `MAX_NAME = 40`.
  - `displayName(agent: Pick<AgentConfig, 'label' | 'name'>): string` → `agent.name ?? agent.label`.
  - `cleanName(text: string): string | undefined` → `text.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME).trim() || undefined`.
  - `nextAgentLabel` unchanged: it reads `label`, which a rename never touches.
- `tests/layout.test.ts` (modified): new `describe('agent names')` for AC4: `displayName` with and without `name`; `cleanName` on padded/multi-space text, blank text and a 50-character name; `nextAgentLabel` returning `Claude 3` when `Claude 2` has `name: 'Google OAuth'`. Existing tests untouched.
- `src/renderer/src/stores/workspaces.ts` (modified):
  - Interface: `renameAgent(workspaceId: string, agentId: string, text: string): void`, doc "An empty name goes back to the automatic one."
  - Implementation: through `updateWorkspace`, map the agent to `{ ...rest, ...(name ? { name } : {}) }` where `name = cleanName(text)` and `rest` is the agent without `name`, so clearing removes the key from saved state. No-op (no state change, no save) when the cleaned name equals the current `name`.
  - Display sites switch to `displayName(a)`: the dirty-worktree prompt (`what`), "Could not remove the worktree of …", "Could not create a worktree for …". `worktrees.add(workspace.path, agent.label, name)` keeps `label` (automatic branch name).
- `src/renderer/src/components/AgentTerminal.tsx` (modified):
  - `const name = displayName(agent)`; `namesRef` holds `name` (notifications); Restore/Maximize/Remove labels and titles, the drag payload and `WorktreeMenu`'s `label` prop use `name`.
  - New `AgentName` component in the same file, replacing `<span className="font-medium">{agent.label}</span>`. Props: `name`, `onRename(text)`, `onEditingChange(editing)`.
    - Not editing: `<span data-testid="agent-name" className="min-w-0 truncate font-medium" title={`${name} · double-click to rename`}>`. `onDoubleClick`: `e.stopPropagation()` (so the header doesn't maximize), start editing.
    - Editing: `<input data-testid="agent-name-input" aria-label="Tile name" maxLength={MAX_NAME} defaultValue={name}>`, focused and fully selected on mount (`useEffect` + `select()`). Styled to sit in the header (`h-5 w-48 rounded border border-accent/60 bg-bg px-1 text-xs font-medium outline-none`).
    - `onKeyDown`: Enter → commit; Escape → cancel; `e.stopPropagation()` for every key, so nothing reaches tile handlers.
    - `onBlur` → commit (spec concern 2). A `done` ref makes commit/cancel run once (Enter followed by the blur from unmounting).
    - `onMouseDown`, `onDoubleClick`, `onDragStart`: `stopPropagation()`. The tile root's `onMouseDown` focuses the terminal, which would otherwise steal focus from the field.
    - After commit or cancel, focus returns to the terminal (`termRef.current?.focus()` via a callback from the parent).
  - Header: `draggable={reorder !== null && !editing}` so selecting text in the field never starts a tile drag. The header's own `onDoubleClick` (maximize) stays as is; it is reached from anywhere but the name.
  - `onRename` → `useWorkspaces.getState().renameAgent(workspaceId, agent.id, text)`. The pty effect's dependencies (`agent.id`, provider, cwd, shell) don't include the name, so nothing restarts (R2).
- `src/renderer/src/components/WorkspaceView.tsx` (modified): scope picker label `${displayName(a)} · ${a.worktree.branch}`.
- `src/renderer/src/components/SendToAgent.tsx` (modified): `{displayName(t)}`.
- `src/renderer/src/components/AgentGrid.tsx` (modified): "Creating a worktree for {displayName(agent)}…".
- `e2e/rename.spec.ts` (new): launch/output helpers copied from `smoke.spec.ts` (own userData and project folder per file; the fake agent `echo "fake agent in $(pwd)"; exec cat`). Helper `rename(tile, text)`: double-click `agent-name`, `fill` `agent-name-input`, press Enter.
  - `› rename a tile, and the name survives a relaunch` (AC1, R4).
  - `› escape cancels, an empty name restores the automatic one` (AC2), also: double-clicking the header outside the name still maximizes (spec concern 1), and the Maximize button is labelled `Maximize Google OAuth` (AC3).
  - `› the send picker lists the new name` (AC3): writes `a.txt` into the project, sends it from the Code view's tree as `links.spec.ts › send a file from the tree` does, and picks `send-target` with text `Google OAuth`.
- `e2e/worktrees.spec.ts` (modified): new test `› a renamed agent keeps its branch` (AC3): isolated Claude, note its `agent-branch`, rename to `Google OAuth`; `agent-branch` is unchanged and the Code view's `code-scope` has an option `Google OAuth · <branch>`. Existing tests untouched.
- `e2e/attention.spec.ts` (modified): new test `› a renamed agent is notified by its name` (AC3): start, rename the tile to `Google OAuth` straight away (the fake agent waits 1 s before working), then the one notification's title is `Google OAuth in <folder>`. Existing tests untouched.
- `README.md` (app, modified): one line in the agents section: double-click a tile's name to rename it; the name is saved.

## Order of work
1. Types + `displayName`/`cleanName` + unit tests (AC4). `pnpm --filter squadstorm-ide test`.
2. Store `renameAgent`, and every display site switched to `displayName`. Then `grep -rn "\.label" src/renderer` and check each remaining hit is a provider label, a menu item label, or one of the two deliberate `agent.label` uses (worktree creation, `nextAgentLabel`). `pnpm typecheck`.
3. `AgentName` in the tile header.
4. e2e: `rename.spec.ts`, then the new tests in `worktrees.spec.ts` and `attention.spec.ts`. `pnpm --filter squadstorm-ide test:e2e -- rename worktrees attention`.
5. README. Full run: `pnpm typecheck && pnpm test && pnpm test:e2e`.

Each step builds on the previous one; none are `[P]`.

## What this could break
- **Saved state:** adds an optional key; old files load as before (`loadState` doesn't validate agent fields; the smoke relaunch test covers old-shape agents). Clearing a name removes the key rather than saving `name: undefined`.
- **Tile header:** the name now intercepts double-clicks (by design) and, while editing, mouse-downs and drags. Outside editing, drag-to-reorder starts from the name as before (the span isn't a button, so no change). Smoke's reorder test guards that.
- **Notifications, prompts, pickers:** switch from `label` to `displayName`; with no `name` the output is identical, so existing assertions (`Claude 1 in …`, `Maximize Claude 2`, `Claude 1 · …`) still hold.
- **Automatic numbering and branch names:** keep reading `label`, unchanged.
- **Terminal keystrokes:** the field stops propagation of its own keys only; the terminal never has focus while the field does.

## Riskiest step
Step 3: the header is draggable, has its own double-click, and sits inside a tile whose mousedown refocuses the terminal. Any one of those can steal focus or the double-click and make the field close at once or never open. Checked by AC1/AC2 (field opens, takes typing, Enter/Escape/blur behave) and the maximize-elsewhere check, run in the e2e before moving on; and by hand once in `pnpm dev:ide`, with a screenshot of the editing state for the PR.

## Alternatives rejected
- **Overwrite `label` with the new name:** clearing couldn't restore the automatic name, and `nextAgentLabel` would hand out a renamed tile's old number to the next agent, so two tiles could end up called `Claude 2`.
- **Rename via a pencil button or a context menu:** the spec settled on double-clicking the name.
- **`window.prompt`:** not supported in Electron.

## Proof
- AC1 → `e2e/rename.spec.ts › rename a tile, and the name survives a relaunch`
- AC2 → `e2e/rename.spec.ts › escape cancels, an empty name restores the automatic one`
- AC3 → that test's Maximize-label check; `rename.spec.ts › the send picker lists the new name`; `worktrees.spec.ts › a renamed agent keeps its branch`; `attention.spec.ts › a renamed agent is notified by its name`
- AC4 → `tests/layout.test.ts › agent names`
- AC5 → every existing test green with no edits to existing tests (the diff shows only added tests)
- All → `pnpm typecheck && pnpm test && pnpm test:e2e` output pasted in the PR, plus a screenshot of a tile mid-rename

## Deviations
- 2026-11-06 — `AgentName`'s editing state lives in `AgentTerminal` (it also drives the header's `draggable`), so its props are `name`, `editing`, `onEdit()` and `onDone(text | null)` instead of `name`, `onRename(text)` and `onEditingChange(editing)`. Same behaviour.
- 2026-11-06 — From review (nits):
  - `displayName` uses `||` instead of `??`, so a blank saved name (only possible by hand-editing state) still shows the automatic label and stays double-clickable; covered in `tests/layout.test.ts › agent names`.
  - Enter while an input method is composing (Japanese, Chinese…) no longer saves the name mid-word.
  - `worktrees.spec.ts › a renamed agent keeps its branch` also checks that removing it with uncommitted work asks by its new name.
