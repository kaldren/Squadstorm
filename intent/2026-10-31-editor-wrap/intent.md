# Intent: Wrap long lines in Code mode

Author: Kaloyan (owner). Status: accepted. (A short intent alone, agreed 2026-10-31.)
Origin: idea. Issue: none.

## Problem
When I open a text file in Code mode, long lines run off the right edge of the editor and I have to
scroll sideways to read them.

## Proposed outcome
- Every file opened in Code mode wraps its lines to the width of the editor; nothing scrolls sideways.

## Affected users and systems
Squadstorm IDE, Code mode editor (`CodeEditor.tsx`), including its on-disk conflict comparison.

## Constraints
- The file's content doesn't change: wrapping is visual only, and saving writes the same lines.
- Line numbers, search reveal and ⌘L still refer to real lines, not wrapped ones.

## Out of scope
- A setting or toggle to turn wrapping off.
- The Review and diff views.

## Success criteria
- An e2e test opens a file with a very long line in Code mode and finds no horizontal scroll and the
  line shown over several rows.
- `pnpm typecheck && pnpm test && pnpm test:e2e` green.

## Open questions
None.
