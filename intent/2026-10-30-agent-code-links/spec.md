# Spec: Link the code I'm reading and the agents

From: intent/2026-10-30-agent-code-links/intent.md. Status: accepted.
Standards applied: AGENTS.md, apps/ide/CLAUDE.md, sdlc-loop skill.

## Requirements
1. R1: From the editor or a diff, I can send the selection (or the whole file when nothing is selected) to an agent I pick. It arrives in that agent's prompt as a path with a line range, optionally followed by a note. (Intent outcome 1.)
2. R2: From the file tree and the Changes list, I can send a file to an agent. (Intent outcome 1.)
3. R3: Sending inserts the text without submitting it, unless I choose "Send & submit". (Intent constraint.)
4. R4: After sending, the receiving agent's tile is shown and focused, so I can keep typing. (Follows from R3.)
5. R5: ⌘-clicking a file path in agent output (`src/foo.ts`, `src/foo.ts:42`, `src/foo.ts:42:7`) opens it in the Code view at that line. This only works for files that exist inside the agent's folder. (Intent outcome 2; constraint.)
6. R6: ⌘-clicking an http(s) URL in agent output opens it in the default browser; nothing else opens. (Intent outcome 3; constraint.)
7. R7: Dropping files or images from Finder onto a tile inserts their paths, quoted, into that agent's prompt. (Intent outcome 4.)

## Acceptance criteria
- AC1 (R1, R3, R4): e2e `e2e/links.spec.ts › send a selection to an agent`:
  - Select lines 2–3 of `src/a.ts` and press ⌘L.
  - Pick `Codex 1` (`data-testid="send-picker"`), type the note `use a Map`, and press Enter.
  - The fake agent's input (it echoes its stdin) shows exactly `src/a.ts:2-3 use a Map`, with no newline.
  - The Agents view is shown with Codex 1's tile focused.
- AC2 (R3): same suite: ⌘↵ in the picker also sends a carriage return, and the fake agent echoes a submitted line.
- AC3 (R2): e2e: the send button on a file row in the tree inserts `src/a.ts`.
- AC4 (R5): e2e `› click a path in agent output`: the fake agent prints `see src/a.ts:3`. ⌘-clicking that text in the terminal (through xterm's link provider; the test triggers the provider's `activate` for the matched range, via a test hook) opens `src/a.ts` in the Code view with line 3 selected. A path to a file that doesn't exist is not a link.
- AC5 (R6): e2e: the fake agent prints `https://example.com/x`. Activating the link calls `shell.openExternal` with it (stubbed in main). `file:///etc/passwd` and `javascript:` text are not links.
- AC6 (R7): e2e: dropping a file onto a tile (a synthetic drop event with a File, resolved through `webUtils.getPathForFile`) inserts its absolute path in single quotes.
- AC7: unit tests `tests/links.test.ts`:
  - the path-and-line regex: `a.ts:3`, `a.ts:3:7`, `(src/a.ts:3)`, trailing punctuation, Windows-style paths ignored;
  - the reference formatter: a file, a single line, a range;
  - shell quoting of dropped paths.

## Design
**Reference format:** `path:start-end` (`path:12` for one line, `path` for a whole file), then a space and the note if there is one. It's sent as a **bracketed paste** (`ESC[200~ … ESC[201~`), so Claude Code and Codex treat it as pasted text: no autocomplete popups, no accidental submit. "Send & submit" adds `\r` after the paste. A per-provider format hook (`ProviderInfo.reference?`) is left for later.

**Picking the agent** (`src/renderer/src/components/SendToAgent.tsx`, new):
- A small popover listing the workspace's running tiles (agents first, then terminals). The last focused agent is preselected.
- A note field. Enter = Send, ⌘↵ = Send & submit, Esc = cancel.
- The last focused agent is tracked in the attention store (`lastFocused`), next to `focusRequest`.
- After sending: `setView(workspace, 'agents')` and `requestFocus(agentId)`, reusing the notification click flow.

**Where you send from:**
- ⌘L in `CodeEditor` and `DiffView` (keymap entry). The line range comes from the selection's first and last lines, or no range when nothing is selected.
- A hover button on rows in `FileTree` and `ChangesPanel`.

**Terminal links** (`AgentTerminal.tsx`):
- `term.registerLinkProvider` with two providers:
  - **Paths:** a regex for relative paths with an optional `:line[:col]`. A match becomes a link only if the path resolves inside the tile's cwd and exists, checked against a cached `files.all(cwd)` list that refreshes on `files.onChanged`.
  - **URLs:** `https?://` only.
- Activation requires ⌘ (VS Code's convention), with an underline on hover while ⌘ is held.
- **Path activation:** a new `openRequest` in the workspaces store `{ workspaceId, root, path, line }`. `WorkspaceView` switches to the Code view (and, with agent-worktrees, to the agent's scope), and `CodeView` opens it through its existing `open(path, at)`.
- **URL activation:** `window.open(url)`, which the existing `setWindowOpenHandler` sends to `shell.openExternal`, http(s) only.

**Drops:**
- The tile's `onDrop` handles `dataTransfer.files` (reorder drags carry no files, so the two don't clash).
- Paths come from a new preload helper `api.pathForFile(file)` built on `webUtils.getPathForFile` (Electron removed `File.path`).
- They're inserted single-quoted and space-separated, as a bracketed paste.

## Flagged concerns
- [x] **Plain `path:lines` instead of Claude Code's `@path#L1-10`.** In the terminal, `@` starts each CLI's own file picker, and the two CLIs differ. A plain path works for both, and both read the file themselves. **Resolved 2026-10-30: plain, for both.**
- [x] **⌘-click to open links** (VS Code's terminal convention), instead of a plain click that fights with text selection. Proposed: ⌘-click. **Resolved 2026-10-30: as proposed.**
- [x] **Paths printed relative to some other folder** (e.g. a monorepo package) don't match the agent's cwd and won't link. Proposed: accept. Only paths that resolve and exist become links. **Resolved 2026-10-30: as proposed.**
- [x] **Terminals as receivers.** Plain Terminal tiles are listed too, after the agents (useful for pasting a path into a shell). Proposed: keep them. **Resolved 2026-10-30: as proposed.**

## Risk
Low to medium. Text only ever goes to a pty as paste. Links open only existing files inside the workspace and http(s) URLs. One new preload helper (`pathForFile`), and no new main-process powers beyond the existing `openExternal` handler.

## Open questions
From intent.md:
- Reference format per CLI? **Proposed:** plain `path:lines` for both. See concern 1.
- Insert or submit? **Answered:** insert by default, with Send & submit (R3).
- How do I pick the receiver? **Answered:** a picker preselecting the last focused agent.
- Paths outside the workspace or in worktrees? **Answered:** a link only when the path resolves inside the tile's own cwd (which is the worktree for isolated agents).

## Changelog
