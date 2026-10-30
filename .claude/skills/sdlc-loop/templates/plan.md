# Plan: <short title>

From: intent.md + spec.md in intent/<folder>/. Status: draft.
Written in plan mode; no files changed while writing this.

## Files that change
- `path/to/file.ts` (new | modified | deleted) — what and why
- `path/to/file.test.ts` (new) — covers AC1, AC2

## Order of work
Numbered. Mark steps that touch disjoint files with [P]; they may run in parallel worktrees.
1. …
2. …

## What this could break
Existing behaviour, callers and data paths touched by each step.

## Riskiest step
Which one, why, and how it is checked before moving on.

## Alternatives rejected
Approaches considered and why not.

## Proof
What demonstrates each acceptance criterion from spec.md:
- AC1 → `pnpm --filter <workspace> test -- <file>` green
- AC2 → screenshot matches the mock at `…`
- All → `pnpm typecheck && pnpm test` (and `pnpm test:e2e` when UI or IPC changed) output pasted in the PR

## Deviations
Filled in during implementation, in the same commit as the deviation.
- <date> — what changed from the plan and why
