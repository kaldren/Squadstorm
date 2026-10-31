# Spec: Name an agent's worktree branch

From: intent/2026-10-31-worktree-names/intent.md. Status: Accepted.
Standards applied: AGENTS.md, apps/ide/CLAUDE.md, sdlc-loop skill, intent/2026-10-30-agent-worktrees/spec.md (the design this extends).

## Requirements
1. R1: With Own worktree on, adding a Claude or Codex agent from the header lets me type an optional branch name before the agent is created. (Intent outcome 1.)
2. R2: A typed name puts the agent on `squadstorm/<name>`, and its worktree folder is named `<name>`. (Intent outcome 1; open questions 2 and 4.)
3. R3: An empty name gives the automatic `squadstorm/<label>-<hex>` name, and skipping takes one extra keypress (Enter) at most. (Intent outcome 2.)
4. R4: A name that can't be used is refused before the agent is created, with the reason, and what I typed stays in the field so I can fix it. "Can't be used" means: no letters or digits, too long, or `squadstorm/<name>` already exists as a branch or its folder already exists. (Intent constraint "never overwrite or reuse a branch"; success criterion 3.)
5. R5: A named branch appears wherever an automatic one does (tile, Code view scope picker), and Merge, Open PR and removal work on it unchanged. (Intent outcome 3; constraint; success criterion 4.)
6. R6: Agents without a worktree, Terminal tiles, agents created from Setup, and saved state behave as today. (Intent constraints; success criterion 5.)

## Acceptance criteria
- AC1 (R1, R2, R5): e2e `e2e/worktrees.spec.ts › a named agent works on its own branch`:
  - Own worktree on; click **+ Claude**, type `Login fix` in `branch-name`, press Enter.
  - The new tile's `agent-branch` reads `squadstorm/login-fix`; the agent's `pwd` ends in `/login-fix` and `git branch --show-current` prints `squadstorm/login-fix`.
  - The Code view's scope picker lists `… · squadstorm/login-fix`.
  - The agent commits a file; **Merge into main** brings it to the workspace's `main`.
- AC2 (R3): same file, `› an empty name gets an automatic branch`: click **+ Claude**, press Enter on the empty field; `agent-branch` matches `^squadstorm/claude-\d+-[0-9a-f]{4}$`.
- AC3 (R4): same file, `› a taken name is refused`: with `squadstorm/taken` already a branch in the repo, typing `taken` and pressing Enter shows `branch-name-error` containing `already exists`, the field still holds `taken`, and no tile is added. Escape closes the prompt and adds nothing.
- AC4 (R4): unit tests in `tests/worktrees.test.ts › branch names from a typed name`:
  - `nameSlug('Login fix!')` is `login-fix`; `nameSlug('  Ünïcode / Agent ')` is `n-code-agent`.
  - `nameError('')` is null (automatic name), `nameError('!!!')` asks for letters or digits, a 61-character name is too long.
- AC5 (R4): main-process enforcement: `addWorktree` rejects a name for which `nameError` is non-null, and rejects a branch or folder that exists, without creating anything. Covered through the IPC by AC3 (the renderer's check and main's are the same function and the same git query).
- AC6 (R6): every existing e2e and unit test passes. The only edits to existing tests are in `› removing an agent`, which clicks **+ Claude** with Own worktree on and now presses Enter to accept the automatic name (see flagged concern 2). No assertion is removed or loosened.

## Design
**No data model change.** `AgentWorktree.branch` already holds the branch, and `worktreeDir` already names the folder after the branch without `squadstorm/`. Saved state is untouched (R6).

**Shared** (`src/shared/worktrees.ts`):
- `nameSlug(text)`: like `slug`, but returns `''` instead of `'agent'` for text with no letters or digits.
- `nameError(text): string | null`: null for empty text (automatic name) and for a usable name; otherwise "Use letters or digits." or "Use at most 60 characters." (measured on the slug).
- The branch for a typed name is `squadstorm/<nameSlug(text)>`. It matches the existing guard in `main/worktrees.ts › checked()` (`^squadstorm\/[a-z0-9-]+$`), so Merge, Open PR and removal need no change (R5).

**Main process** (`src/main/worktrees.ts`):
- `addWorktree(root, label, name?)`: with a name, uses `squadstorm/<nameSlug(name)>` instead of `branchName(label, hex)`. Before `git worktree add` it throws if `nameError(name)` is non-null, if `refs/heads/<branch>` exists ("A branch named squadstorm/x already exists. Pick another name."), or if the worktree folder exists. `git worktree add -b` refuses existing branches anyway; the explicit check gives a clear message.
- `checkName(root, name): Promise<string | null>`: the same checks without creating anything, for the prompt.
- IPC: `worktrees.add(root, label, name?)` and `worktrees.checkName(root, name)` in `api.ts`, the preload and `main/index.ts`.

**Renderer:**
- `addAgent(workspaceId, provider, name?)` passes the name through `provision` to `worktrees.add`.
- `WorkspaceView`: when the workspace isolates and the provider isn't a terminal, **+ Claude** / **+ Codex** opens a small popover under the button instead of adding right away:
  - an input (`data-testid="branch-name"`, placeholder "automatic", autofocused),
  - a preview line: `squadstorm/login-fix`, or `squadstorm/claude-3-…` for the automatic name,
  - the error line (`branch-name-error`) when there is one.
  - Enter runs `nameError`, then `checkName`; on success it closes and calls `addAgent`. On failure it shows the error and keeps the text. Escape or clicking outside closes it and adds nothing.
- When the workspace doesn't isolate, the buttons add right away, as today. Terminal always adds right away.
- If creating the worktree still fails afterwards (a race, a git error), today's alert and tile removal apply unchanged.

## Flagged concerns
- [x] **Slug the typed name, or refuse anything that isn't already a slug?** Constraint: intent success criterion 3 ("a name invalid for git is not used and I'm told why"). Proposed: slug it (`Login fix` → `login-fix`) and show the resulting branch live in the preview, so you see exactly what you'll get; only names that slug to nothing or are too long are refused. Alternative: refuse anything outside `a-z 0-9 -`. Slugging also means no `/` in names (`feat/login` → `feat-login`), because the existing safety guard only accepts `squadstorm/[a-z0-9-]+`; allowing `/` would mean loosening that guard. **Resolved 2026-10-31: as proposed (spec accepted).**
- [x] **One extra keypress for every isolated agent, and one existing test changes.** Constraint: intent outcome "skipping is as quick as adding an agent is now" and AC7 of the worktrees spec ("existing e2e pass unchanged"). With the popover, adding an isolated agent becomes click + Enter instead of a click. `› removing an agent` then needs an Enter after its two **+ Claude** clicks. Proposed: accept both. Alternative: keep the click adding immediately and put naming behind a separate control (e.g. a `⌄` beside each button, or ⌥-click), which needs no test change but is easy to miss. **Resolved 2026-10-31: as proposed (spec accepted).**
- [x] **Agents created from Setup can't be named.** Setup creates N agents at once from counters. Proposed: they keep automatic names; naming is only on the header buttons. Renaming afterwards is out of scope per the intent. **Resolved 2026-10-31: as proposed (spec accepted).**
- [x] **Taken name: refuse, not suffix** (intent open question 3). Proposed: refuse with the reason, as R4 says. A silent suffix would give you a name you didn't ask for. **Resolved 2026-10-31: as proposed (spec accepted).**

## Risk
Low to medium. The change only picks a different branch name before the existing worktree code runs; removal, merge and PR code is untouched and its guard still applies. The risky case, reusing an existing branch, is blocked twice: by the explicit check and by `git worktree add -b` itself. No migrations, no new stored data.

## Open questions
From intent.md:
- Prompt after clicking, or an always-visible field? **Proposed:** a popover after clicking + Claude / + Codex. See concern 2.
- Keep the `squadstorm/` prefix? **Proposed:** yes, always; you type only the part after it.
- Taken name: refuse or suffix? **Proposed:** refuse. See concern 4.
- Same name for the worktree folder? **Answered:** yes, it already follows the branch (`worktreeDir`).

## Changelog
- 2026-10-31 — R4's "already exists" now also counts a branch of that name on a remote, and branches nested under the name (`squadstorm/<name>/…`). Reason: review found that a name reused after its PR branch was pushed, merged and deleted locally would push new work into the old, still-open PR, breaking the intent's "never overwrite or reuse a branch"; a nested branch made `git worktree add` fail with a raw git error. AC3 covers both, and also calls `worktrees.add` directly to check main refuses on its own (AC5).
