# Intent: Link the code I'm reading and the agents

Author: Kaloyan (owner). Status: draft.
Origin: idea (gap analysis against VS Code, 2026-10-30). Issue: none.

## Problem
The Code view and the agents don't know about each other. To point an agent at a piece of code, I copy or type the file path and line numbers into its terminal by hand. The other way round, agents print file paths and URLs constantly, but none of them are clickable (only the Fit and WebGL terminal addons are loaded, `apps/ide/src/renderer/src/components/AgentTerminal.tsx:70-80`), so I hunt for the file myself. Dropping a file or a screenshot onto an agent's tile does nothing.

## Proposed outcome
- From the editor, a diff or the file tree, I can send a selection, a hunk or a file to an agent I choose, optionally with a note (like a review comment: "use a Map here").
- Clicking a file path in an agent's output opens that file at that line in the Code view.
- Clicking a URL in an agent's output opens it in my browser.
- Dropping a file or image onto a tile puts its path into the agent's prompt.

## Affected users and systems
Anyone steering agents while reading code. Squadstorm IDE: editor, diff view, file tree, agent tiles. The Claude and Codex CLIs (what reference format they understand).

## Constraints
- Works with both Claude and Codex as they are, through their normal prompt input.
- Never submits a prompt on my behalf unless I ask; I can still edit it before pressing Enter.
- Links only open http(s) URLs in the browser and only files inside the workspace.

## Out of scope
- A chat panel or a built-in agent harness.
- Code navigation (go to definition, references): decided 2026-10-30, not essential for now.
- Sharing the editor's live selection with agents automatically.

## Success criteria
- Selecting lines in the editor and sending them to an agent puts a reference with the path and line range into that agent's prompt.
- Clicking `src/foo.ts:42` printed by an agent opens `src/foo.ts` at line 42.
- Clicking an https URL in agent output opens the default browser and nothing inside the app.
- Dropping a file on a tile inserts its path.
- e2e tests cover sending a selection and opening a clicked path.

## Open questions
- Which reference format does each CLI expect (for example `@path#L10-20` for Claude Code; plain `path:10-20` for Codex)?
- Insert only, or insert and submit when I add a note?
- When several agents exist, how do I pick the receiver: a menu, the last focused agent, a shortcut?
- Should clicked paths that point outside the workspace (or into a worktree) open at all?
