# Intent: Review an agent's changes in one place and keep or discard them

Author: Kaloyan (owner). Status: draft.
Origin: idea (gap analysis against VS Code, 2026-10-30). Issue: none.

## Problem
Reviewing what agents wrote is most of my job in Squadstorm, and it's slow. The Changes panel lists files and I click them one by one, each into a read-only diff (`apps/ide/src/renderer/src/components/DiffView.tsx:48`). Agents often touch 10–30 files at once. When I don't like a change, I can't throw it away from the IDE, neither the file nor a single hunk; I have to ask an agent or use a terminal. I can't commit some files and leave others. And the file tree doesn't show which files changed.

## Proposed outcome
- I can read all changes in one scrolling view, each file collapsible, with how many lines were added and removed.
- I can discard a single hunk or a whole file I don't want.
- I can choose which files go into a commit.
- Changed files are marked in the file tree.
- Once agents have their own worktrees, I can review one agent's changes on their own.

## Affected users and systems
Anyone reviewing agent work. Squadstorm IDE: Code view, Changes panel, diff view, file tree, git integration.

## Constraints
- Discarding is destructive: it must be clear what will be lost, and it must never hit files I didn't choose.
- The current per-file diff and History keep working.
- Stays responsive with dozens of changed files.

## Out of scope
- Code navigation in the diff (go to definition, references): decided 2026-10-30, not essential for now.
- A 3-way merge editor for conflicts.
- Staging partial hunks for commit (discarding hunks is in scope).
- PR review comments on GitHub.

## Success criteria
- All changed files can be reviewed in one view without clicking into each file.
- Each file shows its added/removed line counts.
- Discarding a hunk changes only that hunk on disk, and discarding a file restores it to the last commit (or removes it if it's new).
- A commit can include only the files I selected; the rest stay uncommitted.
- Modified, added and deleted files are visibly marked in the tree.
- e2e tests cover discard and selective commit.

## Open questions
- Is the all-changes view a new tab, the main area of the Changes panel, or a separate mode?
- Discard per hunk and per file, or per file only to start?
- Where do deleted files go when discarded: Trash, or just git restore?
- How is "one agent's changes" chosen once worktrees exist (depends on the agent-worktrees intent)?
