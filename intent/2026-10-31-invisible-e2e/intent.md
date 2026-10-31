# Intent: Invisible e2e, run at the end of every change

Author: Kaloyan (owner). Status: draft. (You agreed on 2026-10-31 that a short intent alone is enough for this change.)
Origin: idea. Issue: none.

## Problem
The e2e suite opens the real app window over and over, taking over the screen and the Dock while it
runs, so it can't run in the background while I work. And the process only requires it when UI or
IPC changed, so changes that "shouldn't" affect the app can still break it unnoticed.

## Proposed outcome
- `pnpm test:e2e` runs without any window appearing and without a Dock icon; I can keep working.
- I can still watch a run when I want to.
- Every change ends with `pnpm typecheck && pnpm test && pnpm test:e2e` green, whatever it touched.

## Affected users and systems
Squadstorm IDE e2e suite; the sdlc-loop skill (both copies), AGENTS.md, apps/ide/CLAUDE.md, README.

## Constraints
- The suite keeps testing the real app the same way; no test gets weaker to become invisible.
- Normal (non-test) launches are unaffected.

## Out of scope
- A Claude Code hook that runs the suite automatically (the rule lives in the process instead).

## Success criteria
- A test checks that during e2e no window is visible and the app isn't in the Dock.
- The full suite passes invisibly, on main and on the open feature branches.
- The process docs require all three commands at the end of every change.

## Open questions
None.
