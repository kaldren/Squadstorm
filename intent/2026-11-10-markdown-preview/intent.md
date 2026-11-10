# Intent: Preview markdown files

Author: Kaloyan (owner). Status: accepted (approved by Kaloyan in session, 2026-11-10).
Origin: idea. Issue: none.

## Problem
When I open a markdown file in Code mode I only see its source. To see how it reads (headings, lists,
tables, code, images, diagrams) I have to open it somewhere else, e.g. on GitHub after pushing.

## Proposed outcome
- A markdown file (`.md`) open in Code mode shows a Preview button.
- Pressing it, or ⌘⇧V, switches the editor pane to the rendered file, in place; pressing it again
  goes back to the source.
- Each tab remembers whether it was showing the preview: switching to another tab and back returns
  to the same view.
- The preview shows what is in the editor, including edits not saved yet.
- It renders GitHub-flavoured markdown (headings, lists, links, tables, task lists, fenced code),
  with syntax colours in code blocks, images (by a path in the repo or a web address), and mermaid
  diagrams.
- A web link in the preview opens in the system browser; a relative link to a file in the repo opens
  that file in Code mode.

## Affected users and systems
Squadstorm IDE, Code mode (`CodeView.tsx`, `CodeEditor.tsx`).

## Constraints
- Previewing never changes the file: no write to disk, no change to the editor's undo history or
  dirty state.
- Markdown in a repo is untrusted (agents and other people write it): the preview must not run
  scripts or load anything from the web that the file didn't ask for.
- The diff and review views keep working as they do today.

## Out of scope
- Side-by-side source and preview.
- Previewing `.markdown` and `.mdx` files.
- Editing in the preview.
- Previewing markdown in the Review and diff views.
- Exporting the preview (PDF, HTML).

## Success criteria
- An e2e test opens a markdown file, presses Preview and finds rendered headings, a table, a
  highlighted code block, a local image and a mermaid diagram; pressing it again shows the source.
- An e2e test toggles the preview with ⌘⇧V.
- An e2e test leaves a tab in preview, switches to another tab and back, and finds the preview.
- An e2e test edits the file without saving and finds the edit in the preview.
- `pnpm typecheck && pnpm test && pnpm test:e2e` green.

## Open questions
Answered by Kaloyan, 2026-11-10:
- Which files count as markdown? `.md` only.
- Does each tab remember whether it was in preview? Yes.
- A keyboard shortcut for the toggle? Yes, ⌘⇧V.
- Do remote images (`https://…`) load? Yes, as well as images in the repo.
