# Plan: Know when an agent needs you

From: intent.md + spec.md in intent/2026-10-30-agent-notifications/. Status: Accepted.
Written without changing any code.

## Files that change
All paths under `apps/ide/`.
- `src/shared/attention.ts` (new): pure rules, no imports beyond types.
  - `nextWaiting({ shell, prev, activity, signal, seen, waiting }): boolean`
    - `signal` is `'bell' | 'osc' | null`.
    - `shell` is true for Terminal tiles.
  - The rules:
    - seen → false.
    - `signal` set → true.
    - `!shell && prev === 'working' && activity !== 'working'` → true.
    - otherwise → `waiting`.
  - `attentionCounts(agentIds, state)` → `{ working, waiting }` for the sidebar.
- `tests/attention.test.ts` (new): AC1.
- `src/renderer/src/stores/attention.ts` (new): zustand store.
  - State: `agents: Record<id, { activity, waiting }>`, `focusRequest: string | null`.
  - Actions: `report(id, patch)`, `clear(id)`, `remove(id)`, `requestFocus(id)`.
  - A module-level subscription sends `window.api.attention.badge(count)` whenever the number of waiting agents changes.
- `src/renderer/src/components/AgentTerminal.tsx` (modified):
  - Seen = `document.hasFocus()` and the tile contains `document.activeElement`. Keyboard focus in a tile implies its workspace, view and tile are on screen, so the spec's longer definition reduces to this.
  - The 500 ms activity poll keeps `prev` and calls `nextWaiting`, and reports to the store only when `activity` or `waiting` changes.
  - `term.onBell` and `term.parser.registerOscHandler(9, text => …)` raise a signal. OSC 9 text is kept as the notification body. Both are ignored while `replaying` is set around `term.write(result.backlog)`.
  - When `waiting` turns true, the tile sends `window.api.attention.notify({ agentId, title: '<label> is waiting', body: '<OSC 9 text or workspace name>' })`, but only if `!document.hasFocus()`.
  - Focus or input on the tile calls `clear(agent.id)`. Unmount calls `remove`.
  - When `focusRequest === agent.id`, the tile focuses its terminal and clears the request.
  - Header: a `waiting` pill (accent) replaces `ActivityPill`, and the border uses the accent ring. The tile root gets `data-attention="waiting"` and `data-focused` while focused.
  - Needs the workspace name for the body: pass `workspaceName` from `AgentGrid`.
- `src/renderer/src/components/AgentGrid.tsx` (modified): passes `workspaceName`. When `focusRequest` targets an agent in this grid that is hidden behind a maximized tile, it restores the grid (`setMaximizedId(null)`).
- `src/renderer/src/components/WorkspaceSidebar.tsx` (modified): under each workspace, `N working · N waiting` (only the non-zero parts), `data-testid="workspace-attention"`, from `attentionCounts`.
- `src/renderer/src/screens/Main.tsx` (modified): subscribes to `window.api.attention.onClicked(agentId)`. It finds the agent's workspace and then calls `setActive`, `setView(id, 'agents')` and `requestFocus(agentId)`.
- `src/shared/api.ts`, `src/preload/index.ts` (modified): `attention: { notify(req): void; badge(count: number): void; onClicked(listener): () => void }`.
- `src/main/index.ts` (modified):
  - `attention:notify` creates an Electron `Notification({ title, body })`. On click it restores and focuses `mainWindow` (`show`, `focus`, `app.focus({ steal: true })`) and sends `attention:clicked`.
  - `attention:badge` calls `app.dock?.setBadge(count ? String(count) : '')`.
  - With `SQUADSTORM_E2E` set, it records to `globalThis.__squadstormNotifications` (`{ agentId, title, body, click }`) and `__squadstormBadge` instead of showing OS notifications, so CI never shows real banners.
- `e2e/attention.spec.ts` (new): AC2–AC7. The fake agent is one `SQUADSTORM_AGENT_CMD` script that branches on its args:
  - agents tick for about 2 s, then `exec cat`;
  - the Terminal (`$1 = -l`) prints bursts, or `\a` when a marker file exists.

  The test stubs `document.hasFocus = () => false` through `page.evaluate`.
- `README.md` (app, modified): mention notifications under "See who's working".

## Order of work
1. `attention.ts` + `tests/attention.test.ts`; `pnpm --filter squadstorm-ide test`.
2. IPC surface: api types, preload, main handlers and test hooks. Run `pnpm typecheck`.
3. Store and the AgentTerminal wiring (signals, waiting, notify, clear, focus request, header UI).
4. Sidebar counts, then the click → workspace/tile flow in `Main.tsx` and `AgentGrid.tsx`.
5. `e2e/attention.spec.ts`, then the full run: `pnpm typecheck && pnpm test && pnpm test:e2e`.

This item touches different files from save-conflicts (`CodeEditor.tsx`, `CodeView.tsx`, `code.spec.ts`), so the two can be built in parallel worktrees.

## What this could break
- Tile header layout: the activity pill is swapped for a waiting pill, and the existing `agent-activity` test id stays on `ActivityPill`. `smoke.spec.ts` checks `online` text, so the pill still shows when not waiting.
- Terminal input: the new focus/input handlers only clear state. `term.onData` keeps writing to the pty as before.
- IPC: three new channels, additive only.
- Hidden workspaces: their tiles keep polling (they already do), so counts stay live.

## Riskiest step
Step 3: deciding "seen" and the transition timing in the real terminal. False positives make noise; false negatives defeat the feature. The pure rules are pinned by unit tests first. The e2e test then drives a real pty through `working → online` with the window stubbed as unfocused, and checks exactly one notification. That ensures a working agent doesn't fire twice and a focused tile doesn't fire at all.

## Alternatives rejected
- Deciding in the main process from pty data. The `ActivityTracker` and the tile's focus state live in the renderer; duplicating them in main adds complexity for nothing.
- Configuring Claude/Codex hooks to send events. It breaks the "no CLI configuration" constraint and covers only some providers.
- A separate "done" state. The spec settled on a single waiting state.

## Proof
- AC1 → `tests/attention.test.ts` green.
- AC2, AC3, AC4 → `e2e/attention.spec.ts › notifies when a background agent finishes` green.
- AC5 → `e2e/attention.spec.ts › sidebar counts working and waiting agents` green.
- AC6 → asserted in both tests (`data-attention` set, then removed on click).
- AC7 → `e2e/attention.spec.ts › terminals only ask for attention with a bell` green.
- All → `pnpm typecheck && pnpm test && pnpm test:e2e` output pasted in the PR; `activity.test.ts` and `smoke.spec.ts` unchanged and green.

## Deviations
- 2026-10-30 — `nextWaiting` also takes `replaying`, so the backlog rule is unit-tested (AC1) rather than only enforced in the tile.
- 2026-10-30 — OSC 9 payloads that start with `<number>;` (ConEmu subcommands such as progress bars) are not treated as notifications; only plain-text OSC 9 is. Otherwise a CLI reporting progress would raise waiting all the time.
- 2026-10-30 — Under `SQUADSTORM_E2E` the dock badge is recorded instead of set, like notifications, so local e2e runs don't leave a badge on the dock.
- 2026-10-30 — A tile resets its previous activity when its agent (re)starts, so a restart after an exit mid-work doesn't count as "stopped working".
- 2026-10-30 — Notification text: title `<label> in <workspace>`, body the OSC 9 text or "Finished, or waiting for your input." (planned: title `<label> is waiting`, body the OSC 9 text or the workspace name). Naming both in the title reads better in Notification Center.
- 2026-10-30 — No `clear(id)` store action: focusing a tile re-evaluates at once, and "seen" clears waiting; typing requires focus, so it clears too.
- 2026-10-30 — From review: the dock badge is reset when the page (re)loads or the window closes; the sidebar marks the active workspace (`aria-current`); a restarted tile reports its fresh activity; main validates notification and badge input (strings, control characters stripped, lengths capped, integer count); only the latest notification per agent is kept. e2e tests added first for the badge reset, switching workspace from a notification, clicking a waiting tile, OSC 9 text and progress reports, and backlog replay after a reload.
- 2026-10-30 — Not done (review nits, accepted): clicking a notification after the window was closed does nothing (closing the window stops the agents anyway); un-maximizing on a notification click has no e2e test.

