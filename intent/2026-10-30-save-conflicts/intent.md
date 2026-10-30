# Intent: Unsaved edits silently overwrite agent changes

Author: Kaloyan (owner). Status: draft.
Origin: bug. Issue: none.

## Problem
When I have unsaved edits in a file and an agent changes the same file on disk, the editor keeps my buffer and doesn't tell me. When I then press ⌘S, my version is written over the agent's, and the agent's change is gone without a trace. Agents edit files all the time, so this can happen whenever I touch a file an agent is also working on.

Evidence (repro):
1. Open any file in the Code view and type something without saving (the tab shows the dirty dot).
2. From a Terminal tile, append a line to that file: `echo "agent line" >> <file>`.
3. Press ⌘S in the editor.
4. The file on disk no longer contains `agent line`.

Where it happens today: dirty buffers skip the reload (`apps/ide/src/renderer/src/components/CodeEditor.tsx:200`), and save writes unconditionally (`CodeEditor.tsx:73-84`).

## Proposed outcome
- When a file I'm editing changes on disk, I'm told right away.
- I can see what changed on disk compared with my edits, then choose to reload theirs or keep mine.
- A save never overwrites changes on disk that I haven't seen.

## Affected users and systems
Anyone hand-editing files while agents run. Squadstorm IDE: Code view editor.

## Constraints
- Files with no unsaved edits keep reloading silently when agents change them, as they do today.
- Saving a file nobody else changed stays a single ⌘S, with no extra prompt.

## Out of scope
- Merging my edits and the agent's edits automatically.
- A 3-way merge editor.
- Local file history or snapshots.

## Success criteria
- The repro above no longer loses the agent's line: I'm warned before anything is overwritten.
- When I keep my version on purpose, the save goes through.
- When I reload, the editor shows the disk version and the dirty dot clears.
- An e2e test covers the repro.

## Open questions
- Should the warning appear as soon as the file changes on disk, or only when I save, or both?
- What choices does the warning offer: compare, reload, keep mine?
- What if the file was deleted on disk while I had unsaved edits?
