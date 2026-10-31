# Plan: Name an agent's worktree branch

From: intent.md + spec.md in intent/2026-10-31-worktree-names/. Status: Accepted.
Written without changing any code.

## Files that change
All paths under `apps/ide/`.
- `src/shared/worktrees.ts` (modified):
  - `nameSlug(text)`: the same transformation as `slug`, but `''` when nothing is left (no `'agent'` fallback). `slug` is rewritten as `nameSlug(text) || 'agent'` so both stay in step.
  - `MAX_NAME = 60` and `nameError(text): string | null`: null for blank text and for a usable name; "Use letters or digits." when `nameSlug` is empty; "Use at most 60 characters." when the slug is longer.
  - `namedBranch(text)`: `squadstorm/${nameSlug(text)}`.
- `tests/worktrees.test.ts` (modified): new `describe('branch names from a typed name')` for AC4. Existing tests untouched.
- `src/main/worktrees.ts` (modified):
  - `nameTaken(root, branch): Promise<string | null>`: "A branch named <branch> already exists. Pick another name." when `git rev-parse --verify --quiet refs/heads/<branch>` succeeds; "A folder for <branch> already exists at <path>." when `worktreeDir(...)` exists; else null.
  - `checkName(root, name)`: `nameError(name) ?? (blank ? null : nameTaken(root, namedBranch(name)))`.
  - `addWorktree(root, label, name?)`: when `name?.trim()` is non-empty, throws `nameError`/`nameTaken` messages if any, and uses `namedBranch(name)`; otherwise `branchName(label, hex)` as today. Nothing else in the function changes.
- `src/shared/api.ts`, `src/preload/index.ts`, `src/main/index.ts` (modified): `worktrees.add(root, label, name?)` and `worktrees.checkName(root, name): Promise<string | null>`.
- `src/renderer/src/stores/workspaces.ts` (modified): `addAgent(workspaceId, provider, name?)`; `provision(workspaceId, agentId, name?)` passes it to `worktrees.add`. Export `isolates` for the view.
- `src/renderer/src/components/BranchNamePrompt.tsx` (new): the popover.
  - Props: `root`, `nextLabel` (for the automatic preview), `onAdd(name)`, `onClose()`.
  - Input `data-testid="branch-name"`, autofocused, placeholder "automatic", `aria-label="Branch name"`.
  - Preview in muted mono: `squadstorm/<nameSlug>` or `squadstorm/<slug(nextLabel)>-…` with "(automatic)".
  - Error line `data-testid="branch-name-error"`, shown in the danger colour; cleared when the text changes.
  - Enter: `nameError` locally, then `await window.api.worktrees.checkName(root, text)`; error → show it, keep text and focus; ok → `onAdd(text.trim() || undefined)`. A second Enter while checking is ignored.
  - Escape, or a mousedown outside (the capture-phase listener pattern from `AgentTerminal.tsx:509`), → `onClose()`.
  - Styling follows the tile menu popover (`absolute z-30 rounded-md border border-line bg-panel shadow-xl`).
- `src/renderer/src/components/WorkspaceView.tsx` (modified): state `naming: Provider | null`. Each provider button is wrapped in a `relative` span. On click: if `isolates(workspace, p)` → `setNaming(p)`; else `addAgent` as today. While `naming === p`, render `BranchNamePrompt` under that button with `nextLabel = nextAgentLabel(workspace.agents, p)`. Switching to the Code view or toggling Own worktree closes it.
- `e2e/worktrees.spec.ts` (modified):
  - helper `addNamed(page, provider, name)`: clicks `+ <provider>`, fills `branch-name`, presses Enter.
  - new tests `› a named agent works on its own branch` (AC1), `› an empty name gets an automatic branch` (AC2), `› a taken name is refused` (AC3, including Escape).
  - `› removing an agent`: after each of its two `+ Claude` clicks, `await s.page.getByTestId('branch-name').press('Enter')`. Nothing else changes (AC6).
- `README.md` (app, modified): one sentence in the Own worktree paragraph: clicking + Claude / + Codex asks for an optional branch name.

## Order of work
1. Shared helpers + unit tests (AC4). `pnpm --filter squadstorm-ide test`.
2. Main + IPC: `nameTaken`, `checkName`, `addWorktree(…, name?)`. `pnpm typecheck`.
3. Store: `addAgent`/`provision` take the name. `pnpm typecheck`.
4. `BranchNamePrompt` + `WorkspaceView` wiring. Update `› removing an agent` in the same step, since the click now opens the prompt.
5. e2e AC1–AC3. `pnpm --filter squadstorm-ide test:e2e -- worktrees`.
6. README. Full run: `pnpm typecheck && pnpm test && pnpm test:e2e`.

Every step touches files the next step depends on; none are `[P]`.

## What this could break
- **Adding agents with Own worktree on** now opens the prompt instead of adding right away: the intended change. Tests that click **+ Claude**/**+ Codex** with isolation on are only in `› removing an agent` (lines 181, 198). `› closing a workspace…` unchecks Own worktree before clicking, and `smoke.spec.ts` doesn't isolate, so they're unaffected.
- **Adding agents with Own worktree off, Terminal, and Setup** go through the unchanged path (`addAgent` with no name).
- **`slug` rewritten on top of `nameSlug`**: existing `branch names` unit tests guard that its output doesn't change.
- **Merge, Open PR, removal**: untouched. A named branch `squadstorm/<[a-z0-9-]+>` passes `checked()`, and its folder lies inside the worktrees dir, as the AC1 merge confirms.
- **A name that looks like an automatic one** (`claude-1-abcd`): allowed; the taken check covers collisions either way, and `git worktree add -b` refuses existing branches as a last resort.

## Riskiest step
Step 2: it decides which branch a new worktree uses, and a mistake could reuse an existing branch. Mitigations: the explicit `refs/heads` check, then `git worktree add -b`, which itself refuses existing branches; AC3 runs it against a real repo with a pre-existing `squadstorm/taken`.

## Alternatives rejected
- **Only checking in main, at creation:** a taken name would show today's alert after the tile appeared and vanished, and lose what you typed. The `checkName` pre-check keeps the prompt open with the text; main still enforces against races.
- **Free-form names with `/`:** would need loosening `checked()`, the guard that keeps removal and merge to Squadstorm's own branches (spec concern 1).
- **Native `prompt()`:** Electron doesn't support `window.prompt`, and it couldn't show the live preview or an inline error.

## Proof
- AC1 → `e2e/worktrees.spec.ts › a named agent works on its own branch`
- AC2 → `› an empty name gets an automatic branch`
- AC3, AC5 → `› a taken name is refused`
- AC4 → `tests/worktrees.test.ts › branch names from a typed name`
- AC6 → every existing test green; the diff of `› removing an agent` shows only the two added Enter presses
- All → `pnpm typecheck && pnpm test && pnpm test:e2e` output pasted in the PR

## Deviations
