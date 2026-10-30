# Plan: Review an agent's changes in one place and keep or discard them

From: intent.md + spec.md in intent/2026-10-30-review-changes/. Status: accepted.
Written without changing any code. Built after agent-worktrees is merged (for AC6); everything else is independent of it.

## Files that change
All paths under `apps/ide/`.
- `src/shared/git.ts` (modified):
  - `parseNumstat(out)` parses `git diff --numstat -z` (renames are `added\tremoved\t\0from\0to\0`; binary is `-\t-`);
  - `commitPathspec(changes, selected)` gives the selected paths plus `from` for renames.
- `tests/git.test.ts` (modified): AC8.
- `src/main/git.ts` (modified):
  - `gitNumstat(root)`: `git diff --numstat -z HEAD` (empty tree when there's no HEAD), plus line counts of untracked text files read through `readText`;
  - `gitDiscard(root, change)`, as in the spec;
  - `gitCommit(root, message, paths?)`.

  `shell.trashItem` is imported from electron in main only. Under `SQUADSTORM_E2E`, trashed paths are recorded on `globalThis.__squadstormTrashed` and then removed with `rm`, so the test can assert the call without touching the real Trash.
- `src/shared/api.ts`, `src/preload/index.ts`, `src/main/index.ts` (modified): `git.numstat`, `git.discard`, `git.commit(root, message, paths?)`.
- `src/renderer/src/components/ReviewView.tsx` (new): the stacked review.
  - Per file, a `ReviewFile` section (`data-testid="review-file"`) with a header (`review-stats` showing `+N −M`), **Discard file** and **Open**, and a lazily created `EditorView`.
  - The editor uses `unifiedMergeView({ original, mergeControls: (type, action) => type === 'reject' ? discardButton(action) : hiddenSpan })`.
  - After a reject, `files.write(root, path, view.state.doc.toString())`.
  - The Undo toast keeps the previous content for 10 s and writes it back on click (`data-testid="undo-discard"`).
- `src/renderer/src/components/ChangesPanel.tsx` (modified):
  - per-row checkbox (`data-testid="change-check"`) and a hover Discard button;
  - a "Review all" button (`data-testid="review-all"`);
  - a `selected` set held in `CodeView` so it survives tab switches. New paths default to checked.
- `src/renderer/src/components/CodeView.tsx` (modified): a `review` state shows `ReviewView` in the editor area, replacing the diff or editor the same way `diff` does today. It passes `git.status` to `FileTree`.
- `src/renderer/src/components/FileTree.tsx` (modified): an optional `status` prop. A file row gets `data-git` set to its kind plus the kind's color class. A directory row gets `data-git="changed"` plus a dot when any change path starts with `dir/`.
- `src/renderer/src/components/DiffView.tsx`: unchanged. `ReviewView` reuses its extension setup through a shared `diffExtensions(original, lang, controls)` helper extracted into `DiffView.tsx`.
- `e2e/review.spec.ts` (new): AC1–AC5 on a temp repo.

## Order of work
1. Parsers and unit tests (AC8).
2. Main git functions and IPC. Run typecheck.
3. Selective commit and checkboxes. e2e AC4, and `git.spec.ts` still green (AC7).
4. Tree decorations. e2e AC5.
5. ReviewView with stats and lazy editors. e2e AC1.
6. Hunk discard with Undo, file discard with confirmation. e2e AC2 and AC3.
7. With agent-worktrees merged: an e2e check that an isolated agent's scope reviews only its changes (AC6).
8. Full run.

## What this could break
- Commit-all behaviour: with every box checked, `paths` is omitted and today's `git add -A` path runs unchanged.
- Editors with the file open: a discard writes the file, and the editor follows the existing rules (clean reloads; dirty gets the conflict banner).
- Performance: many sections render only when expanded and visible.

## Riskiest step
Step 6, discarding, because it changes files on disk. Both paths go through `resolveInside` and `--` pathspecs. The e2e test checks after every discard that untouched files stay byte-identical.

## Alternatives rejected
- **Hunk discard through `git apply -R`** of a generated patch: it fails when the file changed again since the diff was taken. Rejecting in the editor and writing the result works against the current content.
- **A third top-level view for Review:** the spec chose the editor area.

## Proof
- AC1 → `e2e/review.spec.ts › review shows every change with line counts`
- AC2 → `› discard a hunk`
- AC3 → `› discard a file`
- AC4 → `› commit selected files`
- AC5 → `› tree marks changes`
- AC6 → `e2e/worktrees.spec.ts › review in an agent's scope`
- AC7 → `e2e/git.spec.ts` unchanged
- AC8 → `tests/git.test.ts`
- All → `pnpm typecheck && pnpm test && pnpm test:e2e` output in the PR

## Deviations
- 2026-10-30 — AC6 is checked in `e2e/worktrees.spec.ts › isolated agents work in their own worktrees` (its scoped Code view already has an agent's change), not a separate test.
- 2026-10-30 — Hunk Discard buttons are styled through a `.cm-discard-hunk` rule in `main.css`, since CodeMirror renders them outside React.
- 2026-10-30 — From review, failing tests first:
  - a hunk discard, and its Undo, write only if the file still holds what the view showed (`files.writeIfUnchanged`, a compare-and-write in main); otherwise nothing is written, the reason is shown and the diff reloads. Only the newest of overlapping diff loads builds the view;
  - discards keep a CRLF file's line endings (the editor works in `\n`; text is converted back when written), and files with mixed endings, binary or non-UTF-8 content, or conflicts get no hunk buttons (only Discard file);
  - git takes paths literally (`--literal-pathspecs`) for add, commit, restore and rm, so `app/[id]/page.tsx` or `:x` never match other files;
  - main discards only an exact current change entry and uses git's current kind for it, not the renderer's (possibly stale) record;
  - an empty new file counts `+0`; unticked files are forgotten once they're no longer changed; "Expand/Collapse all" only looks at current files; hunk buttons work from the keyboard (`onclick`).
- 2026-10-30 — Not done (review nits, accepted): Undo is offered for one hunk at a time and only for files that existed before; a partial commit fails as a whole if a ticked file vanished since the last refresh; paths with tabs or newlines aren't covered by the numstat test; editors are built when their section scrolls into the window (not ahead of it).

