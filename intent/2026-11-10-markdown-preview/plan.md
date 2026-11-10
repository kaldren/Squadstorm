# Plan: Preview markdown files

From: intent.md + spec.md in intent/2026-11-10-markdown-preview/. Status: accepted (approved by Kaloyan in session, 2026-11-10).
Written without changing any code.

## Files that change
All paths under `apps/ide/` unless noted.

- `package.json` (modified): add dependencies `marked@^18.2.0`, `dompurify@^3.4.17`, `mermaid@^12.3.0`, `@lezer/highlight@^1.2.5` (already installed through CodeMirror, now direct). `pnpm-lock.yaml` (repo root) follows. Install with `pnpm install` from the repo root; this worktree has no `node_modules` yet.

- `src/shared/markdown.ts` (new), pure and with no DOM, so unit tests run in Vitest's node environment:
  - `isMarkdown(path: string): boolean` → `/\.md$/i.test(path)`.
  - `type LinkTarget = { kind: 'external'; url: string } | { kind: 'file'; path: string } | { kind: 'anchor'; id: string }`.
  - `resolveLink(fromPath: string, href: string): LinkTarget | null`:
    - `^https?://` → external (the URL as written);
    - `#x` → anchor `decodeURIComponent(x)`;
    - any other scheme (`/^[a-z][a-z0-9+.-]*:/i`: `javascript:`, `file:`, `mailto:`, …) → null;
    - otherwise the path part (before `#`/`?`) is URI-decoded and joined to `parentDir(fromPath)` with `joinInside` → file, or null when it leaves the repo. A leading `/` means the repo root, as on GitHub.
  - `type ImageTarget = { kind: 'repo'; path: string } | { kind: 'web'; url: string }`.
  - `resolveImage(fromPath, src): ImageTarget | null`: `^https://` → web; any other scheme → null; else as a relative link → repo, or null when it leaves the repo.
  - `joinInside(dir, rel): string | null`: splits on `/`, applies `.` and `..`, returns null if `..` climbs past the root. (Local helper, exported for tests.)
  - `slugger(): (text: string) => string`: GitHub's rule. Lowercase; drop everything but letters, digits, spaces, `-` and `_` (Unicode-aware: `/[^\p{L}\p{N}\s_-]/gu`); spaces → `-`. Repeats in the same document get `-1`, `-2`, ….
- `tests/markdown.test.ts` (new): AC7, one `describe` per helper, using the exact cases listed in the spec.

- `src/main/files.ts` (modified): `readImage(root, path): Promise<string>`.
  - `resolveInside`, then check the extension against `IMAGE_TYPES = { png: 'image/png', jpg/jpeg: 'image/jpeg', gif, webp, svg: 'image/svg+xml', avif }`. Anything else throws `Not an image: <path>`.
  - `stat`; over `MAX_IMAGE_BYTES = 10 * 1024 * 1024` throws `Image is too large to show: <path>`.
  - Returns `data:<type>;base64,<…>`.
- `tests/files.test.ts` (modified, tests added only): `readImage` returns a `data:image/png;base64,` URL for a PNG in a temp root; it rejects `../x.png`, `notes.txt` and an 11 MB `.png` (a sparse file made with `truncate`).
- `src/main/index.ts` (modified): `ipcMain.handle('files:readImage', (_e, root, path) => readImage(root, path))` next to `files:read`.
- `src/shared/api.ts` (modified): `files.readImage(root: string, path: string): Promise<string>` with the doc comment "An image in the workspace as a data: URL, for the markdown preview."
- `src/preload/index.ts` (modified): `readImage: (root, path) => ipcRenderer.invoke('files:readImage', root, path)`.
- `src/renderer/index.html` (modified): CSP `img-src 'self' data: https:`. Nothing else in the CSP changes.

- `src/renderer/src/markdown/render.ts` (new), the renderer-only half:
  - `renderMarkdown(source: string): string`: one `Marked` instance with `gfm: true`. A `heading` renderer adds `id={slug(text)}`, using a fresh `slugger()` per call. Returns `DOMPurify.sanitize(html, config)`.
  - DOMPurify config: `FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'base', 'link', 'meta']`, `FORBID_ATTR: ['style']`, default URI checks (which drop `javascript:`). An `uponSanitizeElement`/`afterSanitizeAttributes` hook:
    - `img`: moves `src` to `data-src`, so nothing loads before `resolveImage` decides;
    - `input`: kept only when `type="checkbox"`, and forced `disabled`.
  - `highlightBlocks(container)`: each `pre > code[class^="language-"]` other than mermaid: `LanguageDescription.matchLanguageName(languages, lang, true)?.load()`, parse the text with `support.language.parser`, then `highlightCode(text, tree, oneDarkHighlightStyle, putText, putBreak)` builds spans with the style's classes. The editor theme's `oneDark` already mounts those classes, so the spans are coloured as in the editor. Unknown languages stay plain.
  - `drawMermaid(container)`: when any `code.language-mermaid` exists, `const { default: mermaid } = await import('mermaid')`. Initialise once with `{ startOnLoad: false, theme: 'dark', securityLevel: 'strict' }`. Each block: `mermaid.render(id, text)` and replace the `pre` with a `div.mermaid` holding the SVG. On error, keep the `pre` and add a `p.mermaid-error` with the message.
  - `loadImages(container, root, filePath)`: each `img[data-src]` through `resolveImage`: repo → `window.api.files.readImage` → `src`; web → `src = url`; null or a failed read → `alt` text stays, with `title` saying why.
- `src/renderer/src/components/MarkdownPreview.tsx` (new). Props: `root`, `path`, `source`, `onOpenFile(path: string, opts: { preview: boolean })`.
  - `<div data-testid="markdown-preview" tabIndex={-1} className="markdown-preview h-full overflow-auto">`. Its ref gets `innerHTML = renderMarkdown(source)` in a `useLayoutEffect` on `[source]`, then the three async passes run. A `run` counter discards passes from an older render.
  - Focuses itself on mount, so keys never reach the hidden editor.
  - `onClick`: find the closest `a[href]`, always `preventDefault()`, then `resolveLink(path, href)`:
    - external → `window.open(url)`;
    - file → `onOpenFile(target, { preview: isMarkdown(target) })` (spec concern 4);
    - anchor → `CSS.escape` the id and `scrollIntoView` that heading;
    - null → nothing.
- `src/renderer/src/main.css` (modified): a `.markdown-preview` block, GitHub-like and on the app tokens. Content max width 860px with padding; h1/h2 with a bottom border in `--color-line`; tables with collapsed borders; code with `--font-mono` and a `--color-panel` background; block quotes with a muted left bar; `img { max-width: 100% }`; task-list items without bullets; `.mermaid` centred; `.mermaid-error` in `--color-danger`.

- `src/renderer/src/components/CodeEditor.tsx` (modified):
  - New props: `preview: boolean`, and `onOpenFile(path, opts)` passed through to the preview.
  - `propsRef` also carries `preview`.
  - `const [docVersion, setDocVersion] = useState(0)`. In `createState`'s `updateListener`, when `u.docChanged && shownRef.current === path && propsRef.current.preview`, bump it, so the preview re-renders after a disk reload (`followDisk`). Typing can't happen in preview, so this never runs per keystroke.
  - `show()`'s two `view.focus()` calls (in `requestAnimationFrame`) and the `message === null` focus effect skip when `propsRef.current.preview`.
  - A `useLayoutEffect` on `[preview]`: turning preview on does `viewRef.current?.contentDOM.blur()`; turning it off does `refocus.current = true`, so the existing refocus layout effect gives the editor focus back.
  - Render: the host's `invisible` condition gains `|| (preview && message === null)`. When `preview && message === null && shownRef.current !== null && !(showConflict && comparing)`, render `<div className="absolute inset-0"><MarkdownPreview root path={shownRef.current} source={viewRef.current!.state.doc.toString()} onOpenFile /></div>` (`docVersion` is read in the render so it re-renders). The conflict banner and comparison are unchanged.
- `src/renderer/src/components/CodeView.tsx` (modified):
  - `const [previews, setPreviews] = useState<ReadonlySet<string>>(new Set())`.
  - `open(path, at?, opts?: { preview?: boolean })`: when `at` is given, the path leaves `previews` (a reveal points at a source line). When `opts?.preview`, it joins.
  - `close(path)`: also `setPreviews((p) => toggleIn(p, path, false))`.
  - `const canPreview = active !== null && isMarkdown(active) && !diff && !reviewing`, and `togglePreview = () => active && setPreviews((p) => toggleIn(p, active, !p.has(active)))`.
  - The tab strip becomes `flex` with the tab list in its own `overflow-x-auto min-w-0 flex-1` div. After it, when `canPreview`, comes `<button data-testid="markdown-preview-toggle" aria-pressed={previews.has(active)} title="Preview (⌘⇧V)">Preview</button>`, styled like the existing small header buttons (`text-muted hover:text-fg`, `text-fg` when pressed).
  - Keydown: a `previewRef` holds `{ canPreview, togglePreview }` and is refreshed each render, so the `[hidden]` effect stays as is. In the handler, `key === 'v' && e.shiftKey`: if `previewRef.current.canPreview`, toggle; otherwise `return` without `preventDefault`.
  - Pass `preview={active !== null && previews.has(active)}` and `onOpenFile={(p, o) => open(p, undefined, o)}` to `CodeEditor`.

- `e2e/preview.spec.ts` (new): the launch helper copied from `code.spec.ts` (own userData and project, `SQUADSTORM_AGENT_CMD: 'exec cat'`). The project holds:
  - `docs/guide.md`: `# Guide`, a 2×2 table, two task items, a `ts` fence, a `mermaid` `graph TD; A-->B`, `![logo](img/logo.png)`, links to `https://example.com/x`, `notes.md` and `#setup`, then filler paragraphs and `## Setup` at the bottom so scrolling is observable;
  - `docs/img/logo.png`: a 4×4 PNG written from a base64 constant;
  - `docs/notes.md`;
  - `docs/evil.md`: the three payloads from AC6;
  - `src/a.ts`.

  Tests (spec names): `› preview renders a markdown file and toggles back` (AC1), `› ⌘⇧V toggles the preview` (AC2), `› each tab remembers its preview` (AC3), `› the preview shows unsaved edits and follows agent edits` (AC4), `› links in the preview` (AC5), `› the preview runs nothing from the file` (AC6). It saves `test-results/preview.png` for the PR.
- `README.md` (app, modified): next to the ⌘P line: "**⇧⌘V** (or the Preview button) shows a markdown file rendered, with code colours, images and mermaid diagrams; it shows your unsaved edits." Add a row to the shortcuts table: `| **⇧⌘V** | Preview a markdown file |`.

## Order of work
1. `[P]` Dependencies, `src/shared/markdown.ts` and `tests/markdown.test.ts` (AC7). `pnpm --filter squadstorm-ide test -- markdown`.
2. `[P]` `readImage` in main, IPC, preload, api type, CSP, and `tests/files.test.ts` additions. `pnpm --filter squadstorm-ide test -- files && pnpm typecheck`.
3. `render.ts`, `MarkdownPreview.tsx` and the CSS (needs 1 and 2).
4. `CodeEditor.tsx`, then `CodeView.tsx` (needs 3). `pnpm typecheck`, then check by hand in `pnpm dev:ide` on this repo's own `README.md` and the spec file, and take a screenshot.
5. `e2e/preview.spec.ts`. `pnpm --filter squadstorm-ide test:e2e -- preview`.
6. README. Full run: `pnpm typecheck && pnpm test && pnpm test:e2e`.

Steps 1 and 2 touch disjoint files, but both are small, so one session does them in order.

## What this could break
- **Editor focus and keystrokes (step 4):** the editor stays mounted but invisible under the preview. If it kept focus, typing would edit the file unseen. Guarded by the blur on toggle, the skipped focus calls, and AC4's "file unchanged / no dirty dot" checks.
- **Conflict banner and Compare:** the host's `invisible` condition grows a term. With `preview` false it is identical to today, so `code.spec.ts`'s conflict tests guard the no-preview path.
- **Tab strip layout:** wrapping the tabs in a scroll container could change tab clicking or the middle-click close. Existing `code.spec.ts` tab tests guard it.
- **Keyboard shortcuts:** ⌘⇧V is new; the handler only `preventDefault`s when a markdown file can be previewed. ⌘P and ⌘⇧F take the same path as before.
- **CSP:** `img-src` gains `https:`. Scripts, styles, connect and media are unchanged.
- **Build size:** mermaid sits in its own dynamically imported chunk (electron-vite/rollup splits `import()`), so the main renderer chunk grows only by marked, DOMPurify and the highlighter. Checked by comparing `out/renderer/assets` sizes before and after in the PR.
- **Saved state:** none; `previews` lives in memory like `dirty`.

## Riskiest step
Step 4: the hidden editor and the visible preview share one pane, with focus management, the conflict UI and per-tab switching all touching the same `show()` path. A mistake here means invisible edits or a preview of the wrong file. It's checked before step 5 by hand in `pnpm dev:ide`:
1. Preview, type, and confirm the file has no dirty dot.
2. Switch tabs both ways.
3. Raise a conflict while previewing (edit, then change the file on disk) and use Compare and Reload.

Then by AC1, AC3 and AC4 in e2e.

## Alternatives rejected
- **`react-markdown` + remark/rehype:** safe by default, but rendering raw HTML (spec concern 1) needs `rehype-raw` plus `rehype-sanitize` and a dozen more packages. `marked` + DOMPurify is two small packages and is what GitHub-style renderers commonly use.
- **`highlight.js`/`shiki` for code:** another set of grammars and colours. The editor's own Lezer grammars give identical colours and add no grammar weight.
- **A custom `squadstorm-file://` protocol for local images:** the image URL would work in any context of the page, and we'd need a privileged scheme registered in main. A narrow IPC call that returns a data URL keeps the rendering surface small.
- **Rendering in a sandboxed `<iframe srcdoc>`:** stronger isolation, but link clicks, anchors, focus and theming all have to cross a frame boundary. DOMPurify, the existing CSP and `will-navigate` block cover R8, and AC6 tests it.
- **Preview as a separate tab type in CodeView:** spec R2 asks for an in-place toggle that shares the tab.

## Proof
- AC1 → `e2e/preview.spec.ts › preview renders a markdown file and toggles back`
- AC2 → `e2e/preview.spec.ts › ⌘⇧V toggles the preview`
- AC3 → `e2e/preview.spec.ts › each tab remembers its preview`
- AC4 → `e2e/preview.spec.ts › the preview shows unsaved edits and follows agent edits`
- AC5 → `e2e/preview.spec.ts › links in the preview`
- AC6 → `e2e/preview.spec.ts › the preview runs nothing from the file`
- AC7 → `tests/markdown.test.ts` (plus `tests/files.test.ts` for `readImage`)
- AC8 → every existing test green with no edits to existing tests (the diff adds tests only)
- All → `pnpm typecheck && pnpm test && pnpm test:e2e` output pasted in the PR, plus `test-results/preview.png`

## Deviations
- 2026-11-10 — `marked` is `~18.1.3`, not `^18.2.0`: 18.2.0 was published the day before and pnpm's minimum-release-age rule refused it (pnpm offered to add a `minimumReleaseAgeExclude`, which was reverted rather than committed).
- 2026-11-10 — Headings get a `data-anchor` attribute instead of an `id`, set by `addAnchors` from each heading's rendered text after sanitizing (not in a `marked` heading renderer). DOMPurify also strips `id` and `name` from the file's HTML. That way a file can't clash with or clobber the app's own element ids; `#heading` links look up `[data-anchor=…]`. Same behaviour for AC5. Recorded in the spec's Changelog too.
- 2026-11-10 — `CodeEditor` mirrors `shownRef` into a `shown` state, and the preview renders only when `shown === active`. Without it, switching between tabs that were both loaded didn't re-render, so the preview could show the previous file.
- 2026-11-10 — DOMPurify keeps every `input` but disabled (task-list checkboxes included) instead of removing non-checkbox ones, and also forbids `button`, `textarea` and `select`. Simpler hook, same guarantee (no form controls do anything).
- 2026-11-10 — The preview's content sits in an inner `.markdown-body` column (max 860px, centred), so tables and blocks stay left-aligned within it. With the plan's `> *` rule, tables came out centred (seen in the e2e screenshot).
- 2026-11-10 — The by-hand check in `pnpm dev:ide` (riskiest step) became an extra e2e test, `› a conflict while previewing: compare, then reload into the preview`, plus the AC1 screenshot. That way no window takes over the screen. The check also added a guard so that the post-banner refocus skips the editor while previewing. Running the test without the guard showed it passes anyway: the hidden (`visibility: hidden`) editor can't take focus, so the guard is a second wall, not a fix.
- 2026-11-10 — Bundle check: the main renderer chunk grew from 2,264 KB to 2,424 KB (marked, DOMPurify, highlighter). Mermaid and its layout engines are in separate chunks loaded on first use.
- 2026-11-10 — Turning the preview off focuses the editor directly in a `useLayoutEffect` on `[preview]` (skipped on first mount), instead of setting `refocus.current = true`. The existing refocus effect only re-runs on conflict changes, so it would never have fired. (Found by review.)
- 2026-11-10 — From review:
  - **Important (bug), fixed:** an agent saving a previewed file made images and diagrams flash. They were re-read or redrawn on every render, and the page could jump. Each preview now keeps a `PreviewCache` (image data URLs with their last natural size, sanitized diagram SVGs or errors). Cached ones are applied synchronously, before the next paint; repo images are dropped from the cache when they change on disk; `scrollTop` is kept across renders. New e2e `› an agent saving the file keeps the preview where it was` records every painted frame and fails without the cache ("diagram source", "unloaded image"). Scroll anchoring in Chromium already limits the jump, which is why a scroll-only check didn't catch it.
  - **Important (security), fixed:** `readImage` followed symlinks out of the workspace and read non-regular files (a repo symlink to `/dev/zero` would read until memory ran out). It now `realpath`s the file and the root, refuses anything outside, and requires a regular file before reading. Unit tests cover a symlink out, a symlink to `/dev/zero`, a folder named `*.png` and a symlink that stays inside.
  - **Nits, fixed:**
    - Mermaid's `suppressErrorRendering` is on, and a failed render's scratch element is removed. New e2e `› a broken mermaid diagram shows its source and the error`.
    - Mermaid's SVG goes through a second DOMPurify (SVG and HTML profiles, keeping its scoped `<style>` and label `<foreignObject>`; no `image`, `img` or `a`).
    - The markdown sanitizer also forbids `picture`, `source`, `video`, `audio`, `track`, `image`, `feImage`, `srcset`, `poster` and `background`, and drops `src` from inputs, so every image goes through `resolveImage`.
    - `<a name>`/`id` targets become `data-anchor`, so README-style `[Install](#install)` links work (covered in `› links in the preview`).
    - `resolveLink` lower-cases `HTTP(S)://` so the main process opens it, and follows nothing for `//host/x` or a folder link ending in `/` (unit tests).
    - New e2e `› a search match in a previewed file shows its source`.
  - **Nits, not changed:**
    - ⌘S while previewing does nothing; the spec doesn't ask for it, and it can be its own intent.
    - AC2's "not pasted" check stays as is. Making it non-vacuous means writing to the system clipboard, which would overwrite the user's clipboard on every e2e run.
