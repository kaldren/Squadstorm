# Plan: Unsaved edits silently overwrite agent changes

From: intent.md + spec.md in intent/2026-10-30-save-conflicts/. Status: Accepted.
Written without changing any code.

## Files that change
All paths under `apps/ide/`.
- `src/shared/conflict.ts` (new): `diskChange({ saved, buffer, disk })` returning `'none' | 'in-sync' | 'reload' | 'conflict'`, with `disk: string | null` (null = deleted). Pure, no imports.
- `tests/conflict.test.ts` (new): covers AC5 and AC7.
- `src/renderer/src/components/CodeEditor.tsx` (modified):
  - `Buffer` gains `conflict?: { disk: string | null }`.
  - New prop `onConflict(path, conflicted: boolean)`.
  - The `files.onChanged` handler runs every open, changed buffer through `diskChange` instead of skipping dirty ones (today's line 200). A read failure with `ENOENT` in the message counts as `disk = null`; other read errors are ignored, as today.
    - `reload` → today's in-place replace.
    - `in-sync` → `saved = disk`, `onDirty(false)`.
    - `conflict` → set `buffer.conflict` and call `onConflict(path, true)`.
  - `save()` reads the file before writing (`ENOENT` → `null`). On `conflict` it sets the conflict and returns without writing. Otherwise it writes as today.
  - A `ConflictBanner` (local component in the same file) renders above the editor host while the shown buffer has a conflict: `data-testid="disk-conflict"`, text "This file changed on disk" or "This file was deleted on disk", with buttons **Compare**, **Reload** (hidden when deleted) and **Keep mine**.
    - Reload: dispatch a full replace with `disk`, `saved = disk`, clear the conflict, `onDirty(false)`.
    - Keep mine: `saved = disk ?? ''`, clear the conflict, `onDirty(true)` stays.
    - Compare: toggles a read-only `EditorView` (`data-testid="conflict-diff"`) built like `DiffView.tsx` (`unifiedMergeView({ original: disk ?? '', mergeControls: false })`, `editorTheme`, `lineNumbers()`), with the current buffer as the doc.
  - The banner reads the conflict through a small `useState` mirror (`shownConflict`) updated in `show()` and whenever the shown buffer's conflict changes, since buffers live in a ref.
- `src/renderer/src/components/CodeView.tsx` (modified): keeps a `conflicts` set beside `dirty` and passes `onConflict` to `CodeEditor`. A tab whose path is in it shows a warning-colored dot (`data-testid="conflict-dot"`, `bg-amber-400`) instead of the dirty dot. Closing the tab clears it.
- `e2e/code.spec.ts` (modified): new test `code view: a save never overwrites an agent's change`, covering AC1–AC5. The existing test stays unchanged (AC6).

## Order of work
1. **Failing test first** (bug rule). Add the e2e test for the intent's repro: type without saving, `appendFileSync(file, 'agent line\n')`, ⌘S, then expect the banner and expect the disk to still contain `agent line`. Run `pnpm --filter squadstorm-ide test:e2e -- e2e/code.spec.ts`. Confirm it fails because the disk loses `agent line` and there's no banner. Commit the test on its own.
2. Write `src/shared/conflict.ts` and `tests/conflict.test.ts`; run `pnpm --filter squadstorm-ide test`.
3. CodeEditor:
   - the watcher change,
   - the save guard,
   - the banner with Reload and Keep mine.

   Re-run the e2e test; AC1, AC3 and AC4 pass.
4. Compare view (AC2), then deletion handling (AC5), extending the e2e test for each.
5. CodeView tab marker.
6. Full run: `pnpm typecheck && pnpm test && pnpm test:e2e` from the repo root.

## What this could break
- Clean files reloading on agent edits: the `reload` path keeps today's code. The existing e2e test guards it (AC6).
- Saving: every save now does one extra read. That's cheap: files are at most 2 MB and on local disk. If the read fails for a reason other than `ENOENT` (permissions), the save writes as today, so nothing gets stricter in ways the user can't act on.
- Undo: Reload is a normal transaction, so ⌘Z restores my edits. This is intended.
- Focus: the banner's buttons take focus. After Reload or Keep mine, focus returns to the editor (`view.focus()`).

## Riskiest step
Step 3, the watcher change. Today dirty buffers are skipped before any read. Now every changed, open buffer is read, and the async read races with typing. The existing "re-check after the read" pattern (`CodeEditor.tsx:203-205`) is kept: the decision uses the live doc read *after* the await. The unit tests pin the decision table first, and the e2e test checks the end-to-end path before moving on.

## Alternatives rejected
- Compare-and-write in the main process (new IPC taking the expected content). It closes the last few-millisecond race, but adds an IPC surface. The spec accepts the race.
- Watching mtimes instead of comparing content. Agents often rewrite identical content, and content comparison avoids false conflicts.
- A modal dialog on save. It blocks the agents grid and every other tab; a banner doesn't.

## Proof
- AC1, AC3, AC4 → `e2e/code.spec.ts › code view: a save never overwrites an agent's change` green.
- AC2 → same test asserts `conflict-diff` contains both texts.
- AC5 → `tests/conflict.test.ts` (deleted case) and the deletion part of the e2e test green.
- AC6 → `code view: browse, edit, save, follow agent edits, switch back` green, unchanged.
- AC7 → `tests/conflict.test.ts` green.
- All → `pnpm typecheck && pnpm test && pnpm test:e2e` output pasted in the PR.

## Deviations
