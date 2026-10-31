# Plan: Link the code I'm reading and the agents

From: intent.md + spec.md in intent/2026-10-30-agent-code-links/. Status: accepted.
Written without changing any code. Built after agent-worktrees and review-changes (it touches `AgentTerminal.tsx`, `FileTree.tsx` and `ChangesPanel.tsx`).

## Files that change
All paths under `apps/ide/`.
- `src/shared/links.ts` (new), pure:
  - `findPathLinks(line)` → `{ start, end, path, line?, column? }[]`. Relative paths with an extension, an optional `:line[:col]`, and surrounding punctuation stripped.
  - `findUrlLinks(line)`: http(s) only.
  - `formatReference(path, from?, to?, note?)`.
  - `bracketedPaste(text)`.
  - `quotePath(path)`: single quotes, with embedded `'` escaped as `'\''`.
- `tests/links.test.ts` (new): AC7.
- `src/renderer/src/stores/attention.ts` (modified): `lastFocused: string | null`, set when a tile gets focus.
- `src/renderer/src/stores/workspaces.ts` (modified):
  - `openRequest: { workspaceId; root; path; line?; column? } | null`, with `requestOpen` and `clearOpen`;
  - `sendRequest: { workspaceId; root; path; from?; to? } | null` to open the picker from anywhere in a workspace.
- `src/renderer/src/components/SendToAgent.tsx` (new): the picker popover (`data-testid="send-picker"`).
  - Items: the workspace's tiles (`send-target`), with `lastFocused` preselected.
  - A note input (`send-note`); Enter sends, ⌘↵ sends and submits, Esc cancels.
  - Sending calls `window.api.pty.write(agentId, bracketedPaste(text) + (submit ? '\r' : ''))`, then `setView(workspaceId, 'agents')` and `requestFocus(agentId)`.
- `src/renderer/src/components/CodeEditor.tsx`, `DiffView.tsx` (modified): a `Mod-l` keymap entry that reads the selection's line range and calls a new `onSend(path, from?, to?)` prop.
- `src/renderer/src/components/CodeView.tsx` (modified):
  - wires `onSend` into `sendRequest`;
  - renders `SendToAgent` when the request is for this root;
  - watches `openRequest` for this root and calls its existing `open(path, { line, column, length: 0 })`;
  - `FileTree` and `ChangesPanel` rows get a hover "send" button (`data-testid="send-file"`).
- `src/renderer/src/components/WorkspaceView.tsx` (modified): on an `openRequest` for this workspace, switch to the Code view, and to the scope whose root matches when agent-worktrees is merged.
- `src/renderer/src/components/AgentTerminal.tsx` (modified):
  - `term.registerLinkProvider` for paths (checked against a cached `files.all(cwd)` set, refreshed on `files.onChanged` for that root) and for URLs;
  - activation requires `event.metaKey`;
  - a path activates `requestOpen`, a URL calls `window.open(url)`;
  - an `onDrop` branch for `dataTransfer.files`: `window.api.pathForFile(file)`, `quotePath`, then write them as a bracketed paste. The reorder handlers ignore drags carrying files.
  - Under `SQUADSTORM_E2E`, the tile exposes its link providers on `window.__squadstormLinks[agentId]`, so tests can call `provideLinks` / `activate` directly (WebGL canvas text can't be clicked by text).
- `src/preload/index.ts`, `src/shared/api.ts` (modified): `pathForFile(file: File): string` via `webUtils.getPathForFile`.
- `src/main/index.ts` (modified): under `SQUADSTORM_E2E`, `shell.openExternal` calls are recorded on `globalThis.__squadstormOpened` instead of opening a browser.
- `e2e/links.spec.ts` (new): AC1–AC6. The fake agent echoes stdin (`exec cat` after printing the test lines), so inserted text shows up in the pty backlog.
- `README.md` (app): "Send code to an agent" and the ⌘L, ⌘-click shortcuts in the shortcut table.

## Order of work
1. `links.ts` and unit tests.
2. Store fields, then `SendToAgent` and ⌘L in the editor and diff. e2e AC1, AC2.
3. Tree and Changes send buttons. e2e AC3.
4. Terminal link providers and open requests. e2e AC4, AC5.
5. Drops and `pathForFile`. e2e AC6.
6. README. Full run.

## What this could break
- Tile drag-to-reorder: `onDragOver` and `onDrop` now also see file drags. File drags are checked first (`e.dataTransfer.types.includes('Files')`), and reorder keeps its own path. `smoke.spec.ts` covers reorder.
- Editor keymap: `Mod-l` replaces CodeMirror's default "select line" (`Mod-l` in `basicSetup`). Select line stays available with a triple-click. Recorded as a known trade-off, matching VS Code where ⌘L is used by chat.
- Terminal selection: links need ⌘, so plain clicks and drags still select text.

## Riskiest step
Step 4: link detection on every rendered line. The providers only run for the hovered line (that's xterm's model), and existence checks hit a cached `Set`, so there's no IPC per hover. The unit tests pin the regex against false positives first.

## Alternatives rejected
- **`@xterm/addon-web-links`:** URLs only. A single custom provider covers both paths and URLs with one activation rule.
- **Typing the reference character by character:** it triggers each CLI's autocomplete. A bracketed paste avoids that.

## Proof
- AC1, AC2 → `e2e/links.spec.ts › send a selection to an agent`
- AC3 → `› send a file from the tree`
- AC4 → `› click a path in agent output`
- AC5 → `› click a URL in agent output`
- AC6 → `› drop a file on a tile`
- AC7 → `tests/links.test.ts`
- All → `pnpm typecheck && pnpm test && pnpm test:e2e` output in the PR

## Deviations
- 2026-10-30 — The link test hook (`window.__squadstormLinks`) is installed always, not only under `SQUADSTORM_E2E`: the renderer can't see that variable, and the hook only exposes the tile's own link providers to renderer code.
- 2026-10-30 — Links are underlined whenever hovered (xterm's link decoration), not only while ⌘ is held; they still only open with ⌘.
- 2026-10-30 — Diff editors are now read-only but focusable (`EditorView.editable` is no longer turned off), so text can be selected there and sent with ⌘L. (The review view shares the setup but has no ⌘L.)
- 2026-10-30 — Deleted files in Changes have no send button (there's no file to point at).
- 2026-10-30 — The ⌘L keymap lives in `src/renderer/src/sendKeymap.ts`, shared by the editor and diffs.
- 2026-10-30 — The send button on file rows is an icon (`SendIcon.tsx`), not a "→" character: text in the row broke `code.spec.ts`'s check of the tree's entries, and the row's text should stay the file name.
- 2026-10-30 — AC4 and AC5 share one e2e test (`› click a path or a URL in agent output`): both need the same agent output and hook. The open request carries the folder (`root`) instead of a workspace id; the workspace is found from it.
- 2026-10-30 — From review, failing tests first:
  - pasted text drops every control character (and nested paste markers, repeatedly), so crafted file names can't end the paste early and submit a prompt;
  - links are found on whole logical lines (wrapped rows joined, up to 24 rows) and mapped cell by cell, so they sit on the right cells after wide characters and long wrapped URLs stay whole;
  - the file list behind path links is one shared, watched index per folder (`fileIndex.ts`), so files created after a tile started become links, without opening the Code view, and N tiles in a folder share one listing;
  - the window can't navigate away from the app (`will-navigate` blocked in main, drops outside tiles ignored).
- 2026-10-30 — Also from review: ⌘-sending is off in commit diffs and deleted-file diffs (the reference would point at a version the agent can't see); "Send & submit" sends Enter as its own keystroke after the paste; Enter during IME composition doesn't send; dotfile paths and URLs ending in a parenthesis they opened link correctly; the tree's send icon sits at the row's right edge.
- 2026-10-30 — Not done (review nits, accepted): bracketed paste is used even for programs that didn't enable it (plain shells show the markers); paths with `[`, `(` or `+` (Next.js/SvelteKit routes) don't link; the picker lists every tile of the workspace, including exited ones and agents still getting their worktree, and doesn't prefer the worktree's own agent.

