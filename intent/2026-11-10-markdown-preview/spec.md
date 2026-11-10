# Spec: Preview markdown files

From: intent/2026-11-10-markdown-preview/intent.md. Status: accepted (approved by Kaloyan in session, 2026-11-10).
Standards applied: AGENTS.md, apps/ide/CLAUDE.md, sdlc-loop skill.

## Requirements
1. R1: A `.md` file open in Code mode shows a Preview button; other files don't. (Intent outcome 1, open question 1.)
2. R2: The button, or ⌘⇧V, switches the editor pane between the file's source and its rendered preview, in place. (Intent outcome 2, open question 3.)
3. R3: Each tab remembers whether it shows the preview; switching tabs and back returns to the same view. Closing the tab forgets it. (Intent outcome 3, open question 2.)
4. R4: The preview renders what is in the editor, including unsaved edits, and follows the file when an agent changes it on disk while it is clean (as the editor does today). (Intent outcome 4.)
5. R5: The preview renders GitHub-flavoured markdown: headings, emphasis, lists, links, tables, task lists, block quotes, fenced code with syntax colours, images (a path in the repo or an `https://` address), and ` ```mermaid ` blocks as diagrams. (Intent outcome 5, open question 4.)
6. R6: An `http(s)://` link opens in the system browser; a relative link to a file in the repo opens that file in Code mode; a `#heading` link scrolls the preview to that heading. (Intent outcome 6.)
7. R7: Previewing never changes the file: no write, no change to its undo history or unsaved (dirty) state. (Intent constraint 1.)
8. R8: The preview runs no script from the file and loads nothing from the web except the images the file names. (Intent constraint 2.)
9. R9: The diff, review and conflict views, and every other file, behave as today. (Intent constraint 3.)

## Acceptance criteria
- AC1 (R1, R2, R5, R7): e2e `e2e/preview.spec.ts › preview renders a markdown file and toggles back`:
  - Open a fixture `docs/guide.md` holding a heading, a table, a task list, a ` ```ts ` block, a ` ```mermaid ` flowchart and `![logo](img/logo.png)` (a real PNG in the fixture).
  - `markdown-preview-toggle` is visible with `aria-pressed="false"`. Opening a `.ts` file instead: the toggle is not there.
  - Click it: `markdown-preview` shows an `h1` with the heading text, a `table` with its cells, two `input[type=checkbox][disabled]`, a `pre code` containing coloured spans (at least one `span` with a non-default colour), an `svg` inside the mermaid block, and an `img` whose `naturalWidth > 0`. The source editor is hidden.
  - Click it again: the source editor is visible and shows `# ` at the start of the first line; the tab has no `dirty-dot`.
- AC2 (R2): same file, `› ⌘⇧V toggles the preview`: with the editor focused, ⌘⇧V shows the preview; ⌘⇧V again shows the source. In a `.ts` file ⌘⇧V does nothing (the file content is unchanged: it is not pasted).
- AC3 (R3): same file, `› each tab remembers its preview`: open `guide.md` and `notes.md`; preview `guide.md`; switch to `notes.md` (source shows); back to `guide.md` (preview shows). Close and reopen `guide.md`: source shows.
- AC4 (R4, R7): same file, `› the preview shows unsaved edits and follows agent edits`:
  - Type `## Draft heading` into the source without saving; preview: an `h2` reads `Draft heading`; the tab still shows `dirty-dot`; back in source, ⌘Z removes the typed text (undo history intact); the file on disk is unchanged.
  - With a clean file in preview, write a new heading to it on disk (as an agent would): the preview shows it.
- AC5 (R6): same file, `› links in the preview`:
  - Clicking `[site](https://example.com/x)` records `https://example.com/x` in `__squadstormOpened` (the existing e2e hook) and the app stays on the preview.
  - Clicking `[notes](notes.md)` opens a `notes.md` tab, showing its preview (concern 4).
  - Clicking `[Setup](#setup)` scrolls the `Setup` heading into view.
- AC6 (R8): same file, `› the preview runs nothing from the file`: a fixture holding `<script>window.__pwned=1</script>`, `<img src=x onerror="window.__pwned=1">` and `<a href="javascript:window.__pwned=1">x</a>` (clicked): after previewing, `window.__pwned` is undefined, and the page has no `script` element inside `markdown-preview`.
- AC7 (R5, R6, R8): unit tests `tests/markdown.test.ts`:
  - `isMarkdown('a/b.md')` and `isMarkdown('README.MD')` are true; `.markdown`, `.mdx`, `.ts` are false.
  - `resolveLink('docs/guide.md', href)`: `https://x.y/` → external; `notes.md` → file `docs/notes.md`; `../README.md#top` → file `README.md`; `#setup` → anchor `setup`; `../../etc/passwd` → null (outside the repo); `javascript:alert(1)` and `file:///etc/passwd` → null.
  - `resolveImage('docs/guide.md', src)`: `img/logo.png` → repo path `docs/img/logo.png`; `https://x.y/a.png` → web; `http://x.y/a.png`, `data:…`, `file:…` and paths outside the repo → null.
  - `slug('Getting Started!')` is `getting-started`; a second `Getting Started` in the same document is `getting-started-1` (GitHub's rule).
- AC8 (R9): every existing unit and e2e test passes with no assertion removed or loosened, in particular `code.spec.ts`, `review.spec.ts` and the conflict tests.

## Design
**Where the state lives.** `CodeView` keeps `previews: ReadonlySet<string>`, the tabs showing their preview, next to `dirty` and `conflicts`, and forgets a path when its tab closes (R3). It passes `preview={active !== null && previews.has(active)}` to `CodeEditor`.

**Toggle (R1, R2).** A `Preview` button (`data-testid="markdown-preview-toggle"`, `aria-pressed`, title `Preview (⌘⇧V)`) sits at the right end of the tab bar, outside its scrolling area, shown only when the active tab is a `.md` file and no diff or review is on screen. CodeView's existing capture-phase keydown handler gains ⌘⇧V (Ctrl+Shift+V elsewhere) under the same condition, and prevents the default only then, so ⌘⇧V elsewhere is untouched. A reveal into a previewed file (a search match, a path clicked in an agent's output) turns its preview off, since it points at a line in the source.

**Rendering (R4, R5, R7).** The preview lives inside `CodeEditor`, which owns the live buffers. With `preview` on, the CodeMirror host is made `invisible` (as the conflict comparison does today) and `MarkdownPreview` renders `view.state.doc.toString()` of the shown file. Nothing is dispatched to the editor, so undo history and dirty state are untouched (R7). The existing `updateListener` bumps a counter when the shown document changes, so a disk reload of a clean file (`followDisk`) re-renders the preview (R4). The conflict banner still shows over the preview; Compare shows the comparison, as today.

`MarkdownPreview` (`src/renderer/src/components/MarkdownPreview.tsx`, `data-testid="markdown-preview"`):
- `marked` (GFM: tables, task lists, strikethrough, autolinks) turns the source into HTML; headings get GitHub-style ids from `slug`.
- `DOMPurify` sanitizes it (R8): no `script`, `style`, `iframe`, `object`, `form`, event attributes or `javascript:` URLs; checkboxes stay, disabled. The page CSP (`script-src 'self'`) already blocks inline scripts, so this is a second wall.
- Fenced code is coloured with the editor's own grammars: `@codemirror/language-data` finds the language, `@lezer/highlight`'s `highlightCode` with one-dark's highlight style produces spans, so code looks as it does in the editor.
- ` ```mermaid ` blocks are drawn by `mermaid` (dark theme, `securityLevel: 'strict'`), loaded with a dynamic `import()` only when a file has one. A diagram that fails to parse shows its source and the error.
- Styles: a `.markdown-preview` block in `main.css` using the app's tokens (`--color-fg`, `--color-line`, …), readable width, GitHub-like spacing.

**Images (R5, R8).** `resolveImage` sorts each `img src`: a repo path is read through a new IPC call, an `https://` address is used as is, anything else (`http:`, `file:`, `data:`, outside the repo) is dropped.
- New IPC `files.readImage(root, path): Promise<string>` returns a `data:` URL. It goes through the existing `resolveInside` (no escaping the workspace), accepts only `png jpg jpeg gif webp svg avif`, and refuses files over 10 MB. An SVG in an `<img>` can't run scripts.
- CSP: `img-src 'self' data: https:` (adds `https:`), so web images load (open question 4). `connect-src` is not widened.

**Links (R6).** One click handler on the preview reads the link's `href` and calls `resolveLink(filePath, href)`:
- external → `window.open(url)`, which the main process's existing `setWindowOpenHandler` sends to the system browser (and records in e2e);
- file → `onOpenFile(path)`, CodeView's `open`; the anchor part is ignored; a `.md` target opens in preview (concern 4);
- anchor → scroll the heading with that id into view;
- null → nothing.

The default is always prevented, and `will-navigate` is already blocked, so the window never navigates.

**Pure helpers (unit-tested), `src/shared/markdown.ts`:** `isMarkdown(path)`, `resolveLink(fromPath, href)`, `resolveImage(fromPath, src)`, `slug(text, seen)`. All of them work on `/`-separated repo-relative paths and return `null` for anything that leaves the repo.

**New dependencies (renderer):** `marked`, `dompurify`, `mermaid`; `@lezer/highlight` becomes direct (it is already installed through CodeMirror).

## Flagged concerns
- [x] **Raw HTML inside markdown.** READMEs often use `<details>`, `<img width=…>`, `<br>`, `<kbd>`, `<sub>`. Proposed: render it after sanitizing, as GitHub does (R8 still holds). Alternative: show raw HTML as text, which is safer but renders many READMEs wrongly. **Resolved 2026-11-10: as proposed (Kaloyan asked Claude to choose and accept).**
- [x] **Web images reveal that you opened the file.** Loading `https://` images means a file written by someone else can include a tracking image that learns your IP address and when you previewed it. You asked for web images (open question 4). Proposed: load them automatically. Alternative: show a "Load web images" bar per file, as mail apps do. **Resolved 2026-11-10: as proposed (Kaloyan asked Claude to choose and accept).**
- [x] **Mermaid is large** (a few MB added to the app). Proposed: accept it; it's loaded only when a file has a mermaid block, so startup and other files don't pay for it. Alternative: drop mermaid from this change. **Resolved 2026-11-10: as proposed (Kaloyan asked Claude to choose and accept).**
- [x] **A link to another `.md` file from the preview.** Proposed: it opens that file in preview too, since you were reading, not editing. Alternative: it opens in source, like any other open. **Resolved 2026-11-10: as proposed (Kaloyan asked Claude to choose and accept).**
- [x] **Preview scroll position isn't remembered per tab.** The view (source or preview) is remembered (R3), but the preview starts at the top each time. Proposed: accept for now. Alternative: remember it too, at some extra complexity. **Resolved 2026-11-10: as proposed (Kaloyan asked Claude to choose and accept).**

## Risk
Low to medium. No saved state changes (the preview set lives in memory, like `dirty`). The new attack surface is untrusted markdown rendered as HTML in a window whose preload exposes files and agents to the page. DOMPurify plus the existing CSP and `will-navigate` block cover it, and AC6 tests it. Widening `img-src` to `https:` affects the whole renderer, but only for images, which can't run code. Mermaid's bundle size is the main build cost. The risk to existing behaviour is the editor host being hidden or shown in the wrong combination with the conflict comparison, which AC1, AC4 and AC8 cover.

## Open questions
From intent.md, all answered 2026-11-10:
- Which files? `.md` only (R1).
- Remember per tab? Yes (R3).
- Shortcut? ⌘⇧V (R2).
- Web images? Yes (R5); see concern 2.

New: the five flagged concerns above, all resolved as proposed on 2026-11-10.

## Changelog
