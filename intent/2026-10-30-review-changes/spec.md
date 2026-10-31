# Spec: Review an agent's changes in one place and keep or discard them

From: intent/2026-10-30-review-changes/intent.md. Status: accepted.
Standards applied: AGENTS.md, apps/ide/CLAUDE.md, sdlc-loop skill.
Depends on: agent-worktrees (per-agent scope, R5). Everything else stands on its own.

## Requirements
1. R1: All uncommitted changes can be read in one scrolling view, one collapsible section per file. (Intent outcome 1.)
2. R2: Each file shows how many lines were added and removed. (Intent outcome 1; success criterion 2.)
3. R3: I can discard a single hunk. Only that hunk changes on disk. (Intent outcome 2; success criterion 3.)
4. R4: I can discard a whole file. A tracked file goes back to its last commit; a new file goes to the Trash. (Intent outcome 2; success criterion 3; open question on deleted files.)
5. R5: I can pick which files a commit includes; the rest stay uncommitted. (Intent outcome 3; success criterion 4.)
6. R6: Changed files are marked in the file tree, and folders that contain changes are too. (Intent outcome 4; success criterion 5.)
7. R7: The review works per agent once agents have worktrees. (Intent outcome 5.)
8. R8: Discarding never touches files I didn't choose, and a file discard says what will be lost first. (Intent constraint.)
9. R9: The existing per-file diff, History and commit-all keep working, and the view stays responsive with dozens of changed files. (Intent constraints.)

## Acceptance criteria
- AC1 (R1, R2): e2e `e2e/review.spec.ts › review shows every change with line counts`:
  - Three changed files (modified, added, deleted) appear as three sections.
  - Each header's `+N −M` matches `git diff --numstat` (a new file counts all its lines as added).
- AC2 (R3, R8): e2e `› discard a hunk`: in a file with two separate changed hunks, discarding the first restores those lines on disk. The second change is still on disk, and other files are unchanged.
- AC3 (R4, R8): e2e `› discard a file`:
  - A modified file, after confirming, equals HEAD.
  - A new file is gone from the folder (moved to the Trash; the e2e stubs `shell.trashItem` and checks it was called with the path).
  - A deleted file comes back.
  - Cancel changes nothing.
- AC4 (R5): e2e `› commit selected files`: with two of three files unchecked, Commit creates a commit containing only the checked one, and the other two stay in Changes.
- AC5 (R6): e2e `› tree marks changes`: a modified file in a collapsed folder marks the folder (`data-git="changed"`), and the file shows `data-git="M"` once expanded. A new file shows `A`.
- AC6 (R7): with agent-worktrees merged, the review in an isolated agent's Code scope shows only that agent's changes (an extension of AC5 there).
- AC7 (R9): `e2e/git.spec.ts` passes unchanged.
- AC8: unit tests `tests/git.test.ts` for parsing `git diff --numstat -z` (including renames and binary `-`) and for building the selective-commit pathspec (renames include both paths).

## Design
**Main process** (`src/main/git.ts`):
- `gitNumstat(root)`: `git diff --numstat -z HEAD` plus untracked files counted by lines (binary → null). Returns `Record<path, { added: number | null; removed: number | null }>`. The parser lives in `src/shared/git.ts`.
- `gitDiscard(root, change)`:
  - tracked (`M`/`D`): `git restore --source=HEAD --staged --worktree -- <path>`;
  - `R`: restore `from` and trash `path`;
  - untracked/added (`A`): `shell.trashItem(resolveInside(root, path))`, plus `git rm --cached` if it was staged.
- `gitCommit(root, message, paths?)`: with `paths`, `git add -A -- <paths>` then `git commit -m <message> -- <paths>`. Without `paths`, today's behaviour.
- New IPC: `git.numstat`, `git.discard`, and the optional `paths` on `git.commit`.

**Review view** (`src/renderer/src/components/ReviewView.tsx`, new):
- Opened by a **Review all** button at the top of the Changes panel. It replaces the editor area, like a diff does today.
- One section per change:
  - **Header:** path, `+N −M`, **Discard file**, **Open file**, collapse toggle.
  - **Body:** the same `unifiedMergeView` as `DiffView.tsx`, but with `mergeControls` rendering only a **Discard** button per chunk. Clicking it runs `rejectChunk` on that view, then writes the view's document to disk with `files.write`. Editors with that file open follow through the existing reload/conflict logic.
- **Performance:**
  - Sections render their editor only when expanded and near the viewport (IntersectionObserver).
  - With more than 30 files, sections start collapsed.
  - Sections refresh on `files.onChanged` for their own path only.

**Changes panel** (`ChangesPanel.tsx`):
- A checkbox per file, all checked by default. New files that appear later start checked.
- The Commit button says `Commit 2 of 3` when not all are checked and passes `paths`.
- Discard-file is also available per row (on hover).

**File tree** (`FileTree.tsx`):
- Receives the git status from `CodeView` (already loaded through `useGitStatus`).
- Colors the name by kind (M amber, A green, C red) and sets `data-git`.
- A folder containing changes gets a dot and `data-git="changed"`.

**Per agent:** nothing extra. With agent-worktrees, each worktree has its own `CodeView` root, so its Changes panel, review and tree are already scoped.

## Flagged concerns
- [x] **Hunk discard has no confirmation and no undo.** Proposed: no confirmation (it's a deliberate click on one hunk). Instead, show a toast "Discarded 1 change in foo.ts" with **Undo**, which writes back the previous content, for 10 s. **Resolved 2026-10-30: discard at once, with the Undo toast.**
- [x] **Staging partial hunks** for commit (intent out of scope) stays out. Commit selection is per file. **Resolved 2026-10-30: as proposed.**
- [x] **Where Review lives.** Proposed: the editor area, opened from the Changes panel (keeps the panel as the list, like VS Code's multi-diff editor). Alternative: a third top-level view next to Agents/Code. **Resolved 2026-10-30: as proposed.**
- [x] **New files go to the Trash, but discarded edits to tracked files can't be recovered.** Proposed: accept, behind the confirmation. **Resolved 2026-10-30: as proposed.**

## Risk
Medium. Discard and selective commit change the user's files and history. Mitigations:
- every destructive path goes through `resolveInside` and explicit pathspecs (`--`),
- file discards confirm first,
- new files go to the Trash rather than being deleted,
- e2e tests check that untouched files stay untouched.

No migrations.

## Open questions
From intent.md:
- A new tab, the Changes panel, or a separate mode? **Proposed:** an editor-area view opened from Changes. See concern 3.
- Hunk and file discard? **Answered:** both (R3, R4).
- Where do deleted files go? **Answered:** a tracked file is restored from HEAD; a new file goes to the Trash (R4).
- Per agent? **Answered:** via the worktree scope (R7).

## Changelog
