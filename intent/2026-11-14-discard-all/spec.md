# Spec: Revert all changes at once

From: intent/2026-11-14-discard-all/intent.md. Status: draft.
Standards applied: AGENTS.md, apps/ide/CLAUDE.md, sdlc-loop skill.

## Requirements
1. R1: A **Discard all** button under the list of changes in the Changes panel reverts every listed change: modified and deleted files go back to HEAD, renames are undone, new files go to the Trash. (Intent outcome 1; success criterion 1.)
2. R2: Before anything happens, a confirmation says how many files will be reverted and how many new files go to the Trash, and that edits can't be recovered. Cancel changes nothing. (Intent outcome 2; constraint 1; success criterion 2.)
3. R3: Only the changes the user confirmed are touched; a change that appears afterwards stays. (Intent constraint 2; success criterion 3.)
4. R4: Per-file discard, hunk discard, Review all and commit keep working. (Intent constraint 4.)

## Acceptance criteria
- AC1 (R1, R2): e2e `e2e/review.spec.ts › discard all`:
  - cancelling the confirmation leaves all three changes on disk;
  - confirming leaves `src/a.ts` equal to HEAD, brings back `b.ts`, trashes `c.ts`; the panel shows "No changes." and the button is gone.
- AC2 (R3): e2e `› discard all leaves changes it wasn't given alone`: `git.discardAll(root, ['src/a.ts'])` reverts `src/a.ts` only; `b.ts` stays deleted and `c.ts` stays.
- AC3 (R2): unit test in `tests/git.test.ts` for `discardAllPrompt(changes)`: counts, singular/plural, the Trash line only when there are new files, conflicts mentioned as skipped.
- AC4 (R4): the rest of `e2e/review.spec.ts` and `e2e/git.spec.ts` pass unchanged.

## Design
**Main process** (`src/main/git.ts`):
- Refactor the body of `gitDiscard` into `discardChange(root, change)` (the change is git's current entry).
- New `gitDiscardAll(root, paths)`: reads `git status` once, takes the current entries whose path is in `paths` (R3), skips conflicts, and runs `discardChange` on each in turn. Returns `{ discarded: number; skipped: string[] }`. Every path still goes through `resolveInside` and literal pathspecs.
- IPC `git:discardAll` → `git.discardAll(root, paths)` in `api.ts` and the preload.

**Shared** (`src/shared/git.ts`): `discardAllPrompt(changes)` builds the confirmation text, e.g. "Discard all 5 changes? 3 edited files go back to the last commit and can't be recovered. 2 new files go to the Trash."

**Changes panel** (`ChangesPanel.tsx`):
- Under the list (above the commit message), shown only when there are changes: a small **Discard all** button (`data-testid="discard-all"`), muted, red on hover.
- Click → `confirm(discardAllPrompt(status.changes))` → `git.discardAll(root, paths shown)` through the existing `act('discard', …)`, so errors show in the panel and the status refreshes. Skipped conflicts are reported in the panel's error line.

## Flagged concerns
- [ ] **Conflicted files.** Proposed: skip them (as per-file discard already refuses them) and say so after. Alternative: revert them to HEAD too.
- [ ] **No undo.** Edits to tracked files are gone for good after confirming (new files are in the Trash). Proposed: accept, behind the confirmation, as for per-file discard.
- [ ] **All, not just checked.** Proposed: every listed change, matching the intent; the checkboxes stay for commits only.

## Risk
Medium: it changes many files at once. Mitigations: confirmation with counts, only confirmed paths, git's current entry per file, the same tested per-file discard code path, new files go to the Trash. No migrations.

## Open questions
From intent.md:
- Conflicted files? **Proposed:** skipped and reported (concern 1).

## Changelog
