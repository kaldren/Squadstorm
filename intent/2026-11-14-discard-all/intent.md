# Intent: Revert all changes at once

Author: Kaloyan (owner). Status: draft.
Origin: idea (2026-11-14). Issue: none.

## Problem
When an agent's work goes wrong, I want to throw all of it away and start over. Today the Changes panel only lets me discard one file at a time (the ↺ button on each row, or Discard file in Review all), so with 10–30 changed files I click and confirm each one, or go to a terminal and run git myself.

## Proposed outcome
- A button under the list of changes reverts every uncommitted change in one go.
- It says what will be lost before it does anything, and I can cancel.

## Affected users and systems
Anyone reviewing agent work. Squadstorm IDE: Changes panel, git integration.

## Constraints
- Destructive: the confirmation must say how many files are affected and that edits can't be recovered.
- It must only touch the changes I saw when I confirmed, never a file an agent writes a moment later.
- Same rules as the per-file discard: tracked files go back to the last commit, new files go to the Trash.
- Per-file discard, hunk discard and commit keep working.

## Out of scope
- Undo for the whole revert.
- Reverting commits that were already made.
- Discarding only the checked files.

## Success criteria
- One click plus a confirmation leaves the working tree equal to the last commit (new files in the Trash).
- Cancelling changes nothing.
- A file that wasn't in the confirmed list is left alone.
- e2e test covers it.

## Open questions
- Files with merge conflicts: skip them or revert them too?
