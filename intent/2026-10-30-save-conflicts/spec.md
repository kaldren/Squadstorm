# Spec: Unsaved edits silently overwrite agent changes

From: intent/2026-10-30-save-conflicts/intent.md. Status: accepted.
Standards applied: AGENTS.md, apps/ide/CLAUDE.md, sdlc-loop skill.

## Requirements
1. R1: When a file with unsaved edits changes on disk, the editor tells me right away. (Intent: "I'm told right away.")
2. R2: I can compare the disk version with my edits. (Intent: "I can see what changed on disk compared with my edits.")
3. R3: I can reload the disk version, dropping my edits. (Intent: "choose to reload theirs".)
4. R4: I can keep my edits; the next ⌘S then writes them. (Intent: "or keep mine"; success criterion "when I keep my version on purpose, the save goes through".)
5. R5: ⌘S never writes over disk content I haven't seen. If the disk changed since I last loaded or acknowledged it, the save stops and shows the conflict instead. (Intent: "A save never overwrites changes on disk that I haven't seen.")
6. R6: A file deleted on disk while I have unsaved edits is reported the same way; keeping mine and saving recreates it. (Intent open question on deletion.)
7. R7: Unchanged behaviour: clean files still reload silently, and saving a file nobody else changed is still a plain ⌘S. (Intent constraints.)

## Acceptance criteria
- AC1 (R1, R5): e2e `code.spec.ts › code view: a save never overwrites an agent's change` runs the intent's repro (type without saving, append a line on disk, ⌘S). The banner `data-testid="disk-conflict"` appears, and the file on disk still contains `agent line`.
- AC2 (R2): in the same test, clicking **Compare** shows a diff (`data-testid="conflict-diff"`) containing both `agent line` and my typed text.
- AC3 (R3): clicking **Reload** puts the disk content in the editor, hides the banner and clears the dirty dot.
- AC4 (R4): a second run of the scenario: **Keep mine** hides the banner and leaves the dirty dot; ⌘S then writes my text and the dirty dot clears.
- AC5 (R6): unit test `tests/conflict.test.ts` covers the decision for a deleted file (disk = null). e2e: delete the file while dirty, the banner says it was deleted on disk; Keep mine + ⌘S recreates it.
- AC6 (R7): the existing `code view: browse, edit, save, follow agent edits, switch back` test still passes unchanged.
- AC7 (R1, R5, R6, R7): unit tests in `tests/conflict.test.ts` for the pure decision function (see Design) cover: clean + disk changed → reload; dirty + disk changed → conflict; disk equals saved → nothing; disk equals my buffer → resolved (treated as saved); deleted → conflict when dirty, nothing when clean.

## Design
All changes are in the renderer; no new IPC. `files.read` and `files.write` are enough.

**Pure decision** in a new `src/shared/conflict.ts`:
`diskChange({ saved, buffer, disk }): 'none' | 'reload' | 'conflict' | 'in-sync'`, where `disk` is `string | null` (null = deleted).
- `disk === saved` → `none`
- `disk === buffer` → `in-sync` (the agent wrote what I have; adopt it as saved, no prompt)
- buffer is clean (`buffer === saved`) → `reload` (deleted: `none`, the tab stays as is, matching today)
- otherwise → `conflict`

**CodeEditor** (`src/renderer/src/components/CodeEditor.tsx`):
- The `Buffer` type gains `conflict?: { disk: string | null }`.
- The `files.onChanged` handler (today it `continue`s for dirty buffers, line 200) reads the file for every open buffer and applies `diskChange`. A read error with ENOENT counts as `disk = null`.
- `save()` re-reads the file first. If `diskChange` says `conflict`, it sets the conflict and does not write. Otherwise it writes as today.
- A banner above the editor, shown while the active buffer has a conflict: "This file changed on disk" (or "was deleted on disk") with **Compare**, **Reload** and **Keep mine**. Reload is hidden for a deleted file.
  - **Reload**: replaces the doc with `disk`, sets `saved = disk`, clears the conflict. Undo history is kept, so ⌘Z can bring my edits back.
  - **Keep mine**: sets `saved = disk ?? ''` (the version I've now seen), clears the conflict; the buffer stays dirty.
  - **Compare**: toggles a read-only `unifiedMergeView` under the banner with `original = disk`, `doc = my buffer`, reusing `editorTheme` from the same file the way `DiffView.tsx` does.
- Conflicts on files that aren't on screen are kept on the buffer and show when the tab is opened. A re-render is triggered through the existing `message`-style state (a `conflict` state for the active path).

**CodeView**: no change required; the dirty dot keeps coming from `onDirty`.

## Flagged concerns
- [x] Banner only on the active tab. Background tabs with a conflict don't show anything until opened. Constraint: "I'm told right away." Proposed: also mark the tab (a warning-colored dot instead of the dirty dot). This adds a callback from CodeEditor to CodeView; small. **Resolved 2026-10-30: mark the tab too.**
- [x] Reading every open buffer on each change batch. Agents can rewrite many files at once. Proposed: only read files that are open (already the case: the handler loops over changed paths and skips paths without a buffer). Files over 2 MB already can't be opened, so reads stay bounded. **Resolved: as proposed.**
- [x] A tiny race remains between the re-read in `save()` and the write. An agent writing in those few milliseconds can still be overwritten. Closing it fully needs an atomic compare-and-write in the main process (new IPC). Proposed: accept the race for now; the watcher plus the save check cover the realistic cases. **Resolved: accepted.**

## Risk
Small. Renderer-only, one component plus a pure helper. Worst case is an extra banner or a missed reload, not data loss: the save path only becomes more conservative. No migrations, no external services.

## Open questions
From intent.md:
- Warn as soon as the file changes, on save, or both? **Answered:** both (R1 and R5).
- Which choices? **Answered:** Compare, Reload, Keep mine.
- Deleted on disk while dirty? **Answered:** R6.

## Changelog
