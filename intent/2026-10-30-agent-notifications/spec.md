# Spec: Know when an agent needs you

From: intent/2026-10-30-agent-notifications/intent.md. Status: accepted.
Standards applied: AGENTS.md, apps/ide/CLAUDE.md, sdlc-loop skill.

## Requirements
1. R1: An agent that stops working, or asks for attention through its terminal (bell or OSC 9 notification), becomes **waiting** unless I'm already looking at it. (Intent: "finishes its work or is waiting for my input"; constraint "no noise while I'm actively typing into that agent".)
2. R2: When an agent becomes waiting while the Squadstorm window is unfocused, macOS shows one notification naming the agent and its workspace. (Intent outcome 1; success criterion 1.)
3. R3: Clicking the notification brings the window forward, switches to the agent's workspace and Agents view, and focuses its tile. (Intent outcome 2.)
4. R4: The dock badge shows how many agents are waiting, and is cleared at zero. (Intent outcome 3.)
5. R5: Each workspace in the sidebar shows how many of its agents are working and how many are waiting. (Intent outcome 4.)
6. R6: A waiting agent's tile stands out until I focus it; focusing or typing into the tile clears waiting. (Intent outcome 5; open question "when does it stop counting".)
7. R7: Works for Claude and Codex with no CLI configuration; plain Terminal tiles only notify when their program explicitly asks (bell or OSC 9), never for routine output. (Intent constraints.)

## Acceptance criteria
- AC1 (R1, R7): unit tests `tests/attention.test.ts` for the pure rules (see Design): working→not working while unseen → waiting; while seen → not waiting; bell/OSC 9 while unseen → waiting; Terminal tiles ignore activity transitions; replayed backlog never raises waiting.
- AC2 (R2): e2e `e2e/attention.spec.ts › notifies when a background agent finishes`: a fake agent streams output for ~2 s and goes quiet while the window reports unfocused. Exactly one notification is recorded in main (`__squadstormNotifications` test hook) with the agent label and workspace name in it.
- AC3 (R3): same test: triggering the recorded notification's click handler selects the agent's workspace, shows the Agents view and gives the tile focus (`data-focused`).
- AC4 (R4): same test: the dock badge (read through the test hook) is `1` while the agent waits and `''` after its tile is focused.
- AC5 (R5): e2e: with two workspaces, the sidebar entry of the background one shows `1 waiting` (`data-testid="workspace-attention"`), and working counts match the tiles' pills.
- AC6 (R6): e2e: the waiting tile has `data-attention="waiting"`; clicking into it removes the attribute.
- AC7 (R7): e2e: a Terminal tile that prints output in bursts never becomes waiting; one that prints `\a` does.
- All: existing `activity.test.ts` and `smoke.spec.ts` pass unchanged.

## Design
**Signals** (in `AgentTerminal.tsx`, where the `ActivityTracker` already runs every 500 ms):
- Activity transition: status was `working` and is now not `working`.
- `term.onBell`, and `term.parser.registerOscHandler(9, …)` for OSC 9 notifications; the OSC 9 text becomes the notification body.
- The backlog written on (re)attach is replayed with a `replaying` flag set, so old bells and OSC 9s don't fire again after a renderer reload.

**Pure rules** in a new `src/shared/attention.ts`, unit-tested: `nextAttention({ provider, prevActivity, activity, signal, seen, waiting }) → waiting: boolean`. "Seen" means: window focused, the agent's workspace active, Agents view showing, tile visible (not hidden by a maximized tile) and the tile has keyboard focus.

**Store** `src/renderer/src/stores/attention.ts` (zustand), keyed by agent id: `{ activity, waiting }`. Tiles report into it only when a value changes. The sidebar and tiles read from it. It also holds a `focusRequest: agentId | null` that the tile watches to call `term.focus()`.

**Main process** (`src/main/index.ts`), two new IPC channels in `api.ts` and the preload:
- `attention:notify` `{ agentId, title, body }`: shows an Electron `Notification` if the window is not focused. Its click handler restores and focuses the window and sends `attention:clicked` with the agent id back.
- `attention:badge` `(count)`: `app.dock?.setBadge(count ? String(count) : '')`.
- With `SQUADSTORM_E2E`, notifications and the badge are also recorded on `globalThis.__squadstormNotifications` / `__squadstormBadge`, the way `__squadstormPtys` is today. The e2e test reports the window as unfocused by stubbing `document.hasFocus`, and clicks by calling the recorded handler.

**Renderer reaction to a click**: `setActive(workspaceId)`, `setView(workspaceId, 'agents')`, then `focusRequest = agentId`.

**UI**:
- Tile header: a `waiting` pill (accent color) replaces the activity pill and the tile border uses the accent ring while waiting.
- Sidebar workspace entry: next to "N agents", `2 working · 1 waiting` when non-zero.

## Flagged concerns
- [x] OS notifications only while the window is unfocused (VS Code's default). When the window is focused but the agent is in another workspace, you get the sidebar count and tile highlight, not a macOS banner. **Resolved 2026-10-30: unfocused only.**
- [x] "Finished" and "waiting for input" can't be told apart from terminal traffic, so both show as **waiting**. The OSC 9 text, when the CLI sends it, says which. **Resolved: single state.**
- [x] Activity is inferred: a long silent step (e.g. a slow test run with no output) looks like "stopped working" after 3 s of quiet and raises a false waiting. Proposed: accept for now; tune `QUIET_MS` later if it's noisy. The notification only fires while you're away from the window, which limits the noise. **Resolved: accepted.**
- [x] Claude Code and Codex may not emit bells or OSC 9 by default in an unknown terminal. The activity transition is the primary signal; bell/OSC 9 are a bonus. No CLI config is written (constraint). **Resolved: as proposed.**

## Risk
Medium. Touches the tile, the sidebar, a new store and two IPC channels. Failure modes are noisy or missing notifications, not lost work. The macOS notification permission prompt appears the first time a notification is shown, for packaged builds. No migrations; nothing stored on disk.

## Open questions
From intent.md:
- Which signals? **Answered:** activity transition (primary), bell and OSC 9 (R1, Design).
- Unfocused only, or also off-screen? **Proposed:** OS notification only when unfocused; in-app indicators always. See flagged concern 1.
- When does waiting clear? **Answered:** focusing or typing into the tile (R6).

## Changelog
