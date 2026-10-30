# Plan: Run each agent in its own worktree

From: intent.md + spec.md in intent/2026-10-30-agent-worktrees/. Status: draft.
Written without changing any code.

## Files that change
All paths under `apps/ide/`.
- `src/shared/worktrees.ts` (new): pure helpers.
  - `branchName(label, suffix)` gives `squadstorm/claude-2-9f3a`.
  - `worktreeDir(base, workspacePath, branch)` gives `<base>/<repo name>-<6-char hash>/<slug>`. The hash is a tiny FNV-1a of the workspace path, so there's no crypto import in shared code.
  - `parseWorktreeList(out)` parses `git worktree list --porcelain`.
  - `prCommands(wt)` returns the push and `gh pr create` argument lists.
- `tests/worktrees.test.ts` (new): AC4 and AC9.
- `src/shared/types.ts` (modified): `AgentConfig.worktree?: { path; branch; base }` and `Workspace.isolate?: boolean`.
- `src/main/worktrees.ts` (new): `addWorktree`, `inspectWorktree`, `removeWorktree`, `mergeWorktree`, `openWorktreePr`, as in the spec's Design. It uses `git()` from `git.ts` (exported for this) and `run`/`gitEnv` from `github.ts`. The base dir is `SQUADSTORM_WORKTREES_DIR` or `~/SquadstormIDE/worktrees`. `openWorktreePr` opens the URL `gh` prints with `shell.openExternal`.
- `src/main/git.ts` (modified): export `git()`.
- `src/shared/api.ts`, `src/preload/index.ts`, `src/main/index.ts` (modified): `worktrees.add/inspect/remove/merge/openPr` IPC.
- `src/renderer/src/stores/workspaces.ts` (modified):
  - `NewWorkspace.isolate`; `setIsolate(workspaceId, on)`.
  - `addAgent`: when the workspace isolates and the provider isn't a shell, it inserts the agent with `worktree: undefined, pending: true` (pending is in-memory only, kept in a `pendingWorktrees` set rather than on `AgentConfig`), calls `worktrees.add`, then sets `worktree`. On failure it removes the agent and shows the error with `alert`.
  - `createWorkspace` does the same for the initial agents.
  - `removeAgent` becomes async: inspect, confirm when dirty (`confirm()` with the counts), remove, then kill the pty.
  - `removeWorkspace` runs the same checks with one combined confirmation.
- `src/renderer/src/components/AgentGrid.tsx` (modified): `cwd={agent.worktree?.path ?? workspace.path}`. A pending agent renders a placeholder tile "Creating worktree…" instead of `AgentTerminal`.
- `src/renderer/src/components/AgentTerminal.tsx` (modified):
  - the header shows `agent.worktree.branch` (`data-testid="agent-branch"`);
  - a `⋯` menu button (`data-testid="agent-menu"`) with Merge into <base>, Open PR, Show code and Copy path;
  - results and errors appear in a small inline message under the header for 6 s.
- `src/renderer/src/components/WorkspaceView.tsx` (modified):
  - the isolation toggle (`data-testid="isolate-toggle"`), disabled with a reason outside git repos or on a detached HEAD. It reads `git.status`, which is already available;
  - a scope picker (`data-testid="code-scope"`) shown in the Code view when isolated agents exist;
  - one `CodeView` per opened scope, kept mounted;
  - "Show code" sets the scope through a new store field `codeScope[workspaceId]`.
- `src/renderer/src/screens/Setup.tsx` (modified): the "Give each agent its own worktree" checkbox (`data-testid="isolate"`), shown when the chosen folder is a git repo (checked with `git.status`), or always for GitHub clones.
- `e2e/worktrees.spec.ts` (new): AC1–AC3, AC5, AC6, AC8. It uses a temp git repo with an initial commit, `SQUADSTORM_WORKTREES_DIR` pointing to a temp dir, and a fake agent that prints `pwd`, its branch, and then runs commands it reads from stdin, so the test can make it write and commit files.
- `tests/store.test.ts` (new, small): `loadState` keeps workspaces and agents without the new fields (AC7).
- `README.md` (app): a short "Worktrees" paragraph under Features.

## Order of work
1. Shared helpers and their unit tests.
2. Main: `worktrees.ts`, IPC and types. Run `pnpm typecheck`.
3. Store changes plus AgentGrid cwd and pending tiles. Run the existing e2e suite: nothing changes while isolation is off.
4. Setup checkbox and header toggle. e2e AC1–AC2.
5. Tile menu: merge, PR, show code. e2e AC3.
6. Scope picker in WorkspaceView. e2e AC5 and AC8.
7. Removal rules. e2e AC6.
8. README. Full run: `pnpm typecheck && pnpm test && pnpm test:e2e`.

## What this could break
- Spawning: the cwd prop now comes from the agent. Shared agents get `workspace.path` as before, and `smoke.spec.ts` guards that.
- `removeAgent` and `removeWorkspace` become async. Callers in `AgentGrid` and `WorkspaceSidebar` don't await a result, but the UI must not remove the tile before the confirmation. Order: confirm, then remove the worktree, then update the store.
- Saved state with the new fields loads in older builds too: unknown fields are ignored.
- `git worktree add` leaves an entry under `.git/worktrees`. `git worktree remove` cleans it up, and `git worktree prune` runs after each remove.

## Riskiest step
Step 7, removal, because it deletes folders and branches. Removal only ever calls `git worktree remove` (with `--force` only after the user confirmed discarding a dirty tree) and `git branch -d` (never `-D`). The e2e test checks the three cases on a real repo before anything else is built on top.

## Alternatives rejected
- **Claude's `-w/--worktree` flag:** Claude only. Squadstorm wouldn't know the path or the branch.
- **Worktrees inside the repo** (`.worktrees/`): they'd show up in search, watchers and git status unless ignored, and would touch the user's `.gitignore`.
- **Clones instead of worktrees:** slower and heavier, and branches wouldn't be shared with the workspace for merging.

## Proof
- AC1, AC2 → `e2e/worktrees.spec.ts › isolated agents work in their own worktrees`
- AC3 → `› merge brings an agent's commits back`
- AC4, AC9 → `tests/worktrees.test.ts`
- AC5, AC8 → `› the code view can be scoped to an agent's worktree`
- AC6 → `› removing an agent`
- AC7 → `tests/store.test.ts`; the existing e2e tests pass unchanged
- All → `pnpm typecheck && pnpm test && pnpm test:e2e` output in the PR

## Deviations
