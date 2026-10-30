# Spec: Run each agent in its own worktree

From: intent/2026-10-30-agent-worktrees/intent.md. Status: draft.
Standards applied: AGENTS.md, apps/ide/CLAUDE.md, sdlc-loop skill.

## Requirements
1. R1: In a git workspace, a new agent can get its own git worktree on its own branch, created from the workspace's current branch. (Intent outcome 1.)
2. R2: An isolated agent runs in its worktree: its edits never touch the workspace folder or other agents' worktrees. (Intent outcome 1; success criterion 1.)
3. R3: An isolated agent's tile shows its branch. (Intent outcome 2.)
4. R4: I can bring an isolated agent's committed work back: merge its branch into the workspace's branch, or open a PR for it. (Intent outcome 3.)
5. R5: I can browse, diff and commit an isolated agent's work in the Code view, scoped to its worktree. (Intent open question on Changes/History.)
6. R6: Removing an isolated agent removes its worktree. It asks first when that would discard uncommitted changes, and keeps the branch when it holds commits that aren't merged. (Intent constraint "never deletes uncommitted work without asking"; success criterion 3.)
7. R7: Shared agents, Terminal tiles and existing saved workspaces behave exactly as today. (Intent outcome 4; constraints.)
8. R8: Works for every provider, through Squadstorm and not the CLIs' own worktree flags. (Intent constraint.)
9. R9: Worktrees don't show up in the workspace's file tree, search, Quick Open or Changes. (Intent constraint.)

## Acceptance criteria
- AC1 (R1, R2, R8): e2e `e2e/worktrees.spec.ts › isolated agents work in their own worktrees`:
  - A git workspace starts with "Own worktree per agent" on and two agents: one fake Claude, one fake Codex.
  - Each fake agent prints `pwd` and `git branch --show-current`. These differ from the workspace folder and from each other, and are on `squadstorm/…` branches.
  - A file written in one worktree is absent from the other worktree and from the workspace folder.
- AC2 (R3): same test: each tile's header shows its branch (`data-testid="agent-branch"`).
- AC3 (R4): e2e `› merge brings an agent's commits back`: the agent commits a file in its worktree, then **Merge into main** from the tile menu. The workspace's `main` has the commit, and the workspace folder has the file.
- AC4 (R4): unit test `tests/worktrees.test.ts › pr command`: the PR action builds `git push -u origin <branch>` then `gh pr create --head <branch> --base <base> --fill`. Real GitHub isn't exercised in e2e.
- AC5 (R5): e2e: picking the agent's worktree in the Code view's scope picker lists its changed file in Changes, and its diff opens.
- AC6 (R6): e2e `› removing an agent`:
  - A clean worktree with no commits of its own is removed together with its branch.
  - A worktree with uncommitted changes asks first. Cancel keeps everything; confirming removes it.
  - A branch with commits that aren't merged is kept after its worktree is removed.
- AC7 (R7): `smoke.spec.ts` and every other existing e2e test pass unchanged. A saved `state.json` from before this change loads (unit test on the state loader).
- AC8 (R9): e2e: after an isolated agent writes `wt-only.txt`, Quick Open in the workspace doesn't find it, and the workspace's Changes stay empty.
- AC9: unit tests in `tests/worktrees.test.ts` for branch naming (slug, uniqueness suffix), the worktree path layout, and parsing `git worktree list --porcelain`.

## Design
**Data model** (`src/shared/types.ts`):
- `AgentConfig.worktree?: { path: string; branch: string; base: string }`, where `base` is the branch it was created from.
- `Workspace.isolate?: boolean` is the default for new agents.

Both fields are optional, so saved state loads unchanged (R7).

**Where worktrees live:** `~/SquadstormIDE/worktrees/<repo folder name>-<6-char hash of the workspace path>/<branch slug>`. This is outside the repo, so the watcher, search and git status of the workspace never see them (R9). It follows `reposDir` in `src/main/github.ts`. `SQUADSTORM_WORKTREES_DIR` overrides it for tests.

**Branch name:** `squadstorm/<agent label slug>-<4 hex chars>`, e.g. `squadstorm/claude-2-9f3a`. It's created from the workspace's current branch at its current commit. A detached HEAD or a non-git folder disables isolation (the toggle is greyed out with the reason).

**Main process** (`src/main/worktrees.ts`, new; reuses `git()` / `run()` from `git.ts`/`github.ts`):
- `add(root, label)`: `git worktree add -b <branch> <path> HEAD`. Returns the `worktree` record.
- `inspect(root, wt)`: uncommitted change count (`git status --porcelain` in the worktree), and commits not in base (`git rev-list --count <base>..<branch>`).
- `remove(root, wt, { force })`: `git worktree remove [--force] <path>`. Then `git branch -d <branch>` only if it has no commits beyond base.
- `merge(root, wt)`: refuses while the workspace isn't on `base` or the worktree has uncommitted changes (the message says which). Otherwise `git merge --no-ff --no-edit <branch>` in the workspace; on conflict, `git merge --abort` and report "Conflicts with <base>: ask the agent to merge <base> into its branch first."
- `openPr(root, wt)`: `git push -u origin <branch>`, then `gh pr create --head <branch> --base <base> --fill`. Opens the PR URL in the browser.
- IPC: `worktrees.add/inspect/remove/merge/openPr` in `api.ts` and the preload.

**Renderer:**
- Spawn uses `agent.worktree?.path ?? workspace.path` as cwd. A missing worktree folder shows the existing error state with the reason.
- **Turning isolation on:**
  - Setup gets a checkbox "Give each agent its own worktree" (git repos only, off by default), stored as `Workspace.isolate`.
  - The workspace header gets the same toggle next to the + buttons; it applies to agents added afterwards.
  - Terminal tiles are never isolated.
- **Creating an agent:** `addAgent` becomes async for isolated agents. The tile shows "Creating worktree…" until `add` returns, then spawns.
- **Tile header:** the branch in muted mono (`agent-branch`), and a `⋯` menu with **Merge into <base>**, **Open PR** and **Show code**. Show code switches to the Code view scoped to the worktree.
- **Code view scope:**
  - `WorkspaceView` gets a scope picker beside Agents/Code: "Workspace" plus one entry per isolated agent.
  - Each scope mounts its own `CodeView root={path}` on first use and keeps it mounted, as today.
  - Changes, History, diffs, commit and push all work as-is, because they're root-based.
- **Removal** (tile ✕ or closing the workspace) calls `inspect` first:
  - Clean and nothing to keep: remove silently.
  - Uncommitted changes: ask "Discard N uncommitted changes in Claude 2's worktree?" (Cancel / Discard).
  - Commits that aren't merged: remove the worktree, keep the branch, and say so.

  Closing a workspace runs the same checks for all its isolated agents, behind one combined confirmation.

## Flagged concerns
- [x] **Default.** Isolation is opt-in (off by default) per workspace. Your own sdlc-loop runs `[P]` steps in parallel worktrees, which argues for on. Proposed: off, because shared is today's behaviour and agents that collaborate need it. **Resolved 2026-10-30: off by default.**
- [ ] **Dependencies in a fresh worktree.** A new worktree has no `node_modules`, so an agent's first `pnpm test` fails until it installs. Proposed: don't install automatically (it's per project and slow); the agent sees the error and runs the install itself. Alternative: an optional per-workspace "setup command" run in each new worktree. Later?
- [ ] **Starting an agent with a task prompt** (intent open question). Proposed: out of scope here, and listed as "later". It needs its own UI and provider-specific arguments.
- [ ] **Merge runs in your workspace folder.** It fails if the workspace has uncommitted changes that touch the same files. Proposed: refuse with git's message and don't auto-stash.
- [ ] **Terminal tiles inside an agent's worktree** (to run that branch's app or tests). Proposed: later. Today you can `cd` into the path shown in the tile menu.

## Risk
Medium to high. It creates and deletes git branches and folders in the user's repos, so a bug in removal could lose work. Mitigations:
- removal only uses `git worktree remove` (git itself refuses to remove dirty worktrees without `--force`),
- `--force` is passed only after an explicit confirmation,
- branches are deleted only with `-d` (git refuses unmerged branches).

No migrations. The state fields are optional.

## Open questions
From intent.md:
- Opt-in or default? **Proposed:** opt-in. See concern 1.
- Where, and how are branches named? **Answered:** Design.
- What happens on removal? **Answered:** R6.
- Merge or PR? **Answered:** both (R4).
- Task prompt? **Proposed:** later. See concern 3.
- Changes/History for an agent? **Answered:** the scope picker (R5). Multi-file review is the review-changes intent.

## Changelog
