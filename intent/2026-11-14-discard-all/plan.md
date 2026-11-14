# Plan: Revert all changes at once

From: intent.md + spec.md in intent/2026-11-14-discard-all/. Status: draft.
Written without changing any code.

## Files that change
All paths under `apps/ide/`.
- `src/shared/git.ts` (modified): `discardAllPrompt(changes: FileChange[]): string`.
- `tests/git.test.ts` (modified): AC3.
- `src/main/git.ts` (modified): `discardChange` extracted from `gitDiscard` (which keeps its lookup and conflict check); new `gitDiscardAll(root, paths)`.
- `src/shared/api.ts`, `src/preload/index.ts`, `src/main/index.ts` (modified): `git.discardAll(root, paths): Promise<{ discarded: number; skipped: string[] }>`.
- `src/renderer/src/components/ChangesPanel.tsx` (modified): the **Discard all** button under the list.
- `e2e/review.spec.ts` (modified): AC1, AC2.

## Order of work
1. Failing unit test for `discardAllPrompt`, then the helper (AC3).
2. Extract `discardChange`, add `gitDiscardAll` and the IPC. Typecheck.
3. Failing e2e tests (AC1, AC2), then the button.
4. Full run: `pnpm typecheck && pnpm test && pnpm test:e2e`.
5. After the user merges: `pnpm --filter squadstorm-ide dist` on `main`, quit Squadstorm, replace `/Applications/Squadstorm.app` with `apps/ide/dist/mac-arm64/Squadstorm.app`.

## What this could break
- Per-file discard: it now calls the extracted `discardChange`; `discard a file` and the look-alike path tests cover it.
- A discard while an editor has the file open follows the existing reload/conflict rules.

## Riskiest step
Step 2, because it deletes and restores many files. It reuses the per-file path unchanged, limits itself to the confirmed paths and git's current entries, and AC2 checks that unlisted changes survive.

## Alternatives rejected
- **One `git restore . && git clean -fd`:** fast, but `clean` deletes new files permanently instead of trashing them and would also hit files nobody confirmed.
- **Looping `git.discard` from the renderer:** one IPC and one status read per file, and a confirmation per file through the existing code.

## Proof
- AC1 → `e2e/review.spec.ts › discard all`
- AC2 → `› discard all leaves changes it wasn't given alone`
- AC3 → `tests/git.test.ts › discardAllPrompt`
- AC4 → the rest of `e2e/review.spec.ts` and `e2e/git.spec.ts`
- All → `pnpm typecheck && pnpm test && pnpm test:e2e` output in the PR

## Deviations
