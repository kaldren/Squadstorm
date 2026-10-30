# Plan: Agents resume their conversations after a restart

From: intent.md + spec.md in intent/2026-10-30-resume-agents/. Status: draft.
Written without changing any code. Built last: it touches `AgentTerminal.tsx` and `providers.ts`, and uses per-agent cwds from agent-worktrees.

## Files that change
All paths under `apps/ide/`.
- `src/shared/providers.ts` (modified): `ProviderInfo.session?: (ctx: { id: string; soleInFolder: boolean }) => { fresh: string[]; resume: string[] | null }`.
  - Claude: `{ fresh: ['--session-id', id], resume: ['--resume', id] }`.
  - Codex: `{ fresh: [], resume: soleInFolder ? ['resume', '--last'] : null }`.

  New helper `launchArgs(provider, mode, ctx)`: session args come first, then the provider's own args, so Codex's `resume` subcommand leads (`resume --last --no-alt-screen`).
- `tests/sessions.test.ts` (new): AC4 and the argument order for both providers and Terminal.
- `src/shared/types.ts` (modified): `AgentConfig.started?: boolean`.
- `src/shared/api.ts` (modified): `SpawnRequest` gains `mode: 'fresh' | 'resume'` and `soleInFolder: boolean`; `attention.working(count)`.
- `src/main/pty.ts` (modified):
  - `spawnOnce` builds args with `launchArgs`, so the `SQUADSTORM_AGENT_CMD` override still receives them as `"$@"`.
  - For `mode: 'resume'`, it records the start time. If the process exits non-zero within 3 s, it doesn't report the exit: it writes `\r\n[Couldn't resume the previous conversation; started a new one]\r\n` into the stream and spawns once more with `fresh`.
- `src/renderer/src/components/AgentTerminal.tsx` (modified):
  - passes `mode: agent.started ? 'resume' : 'fresh'` and `soleInFolder` (computed by `AgentGrid` from the workspace's agents and their cwds);
  - after the first successful spawn, calls a new store action `markStarted(workspaceId, agentId)`;
  - Restart always uses `resume` once started.
- `src/renderer/src/components/AgentGrid.tsx` (modified): computes `soleInFolder` per tile.
- `src/renderer/src/stores/workspaces.ts` (modified): `markStarted`.
- `src/renderer/src/stores/attention.ts` (modified): it already reports the waiting count; it also sends `attention.working(count)` when the number of working agents changes.
- `src/main/index.ts` (modified):
  - keeps `workingCount`;
  - `confirmQuit()` uses `dialog.showMessageBoxSync(mainWindow, { buttons: ['Quit', 'Cancel'], message: … })`;
  - `mainWindow.on('close', e => …)` and `app.on('before-quit', e => …)` call `preventDefault()` on Cancel, with an `allowQuit` flag so one confirmation covers both events;
  - under `SQUADSTORM_E2E`, the dialog answer comes from `globalThis.__squadstormQuitAnswer`, and calls are counted on `__squadstormQuitAsked`.
- `e2e/resume.spec.ts` (new): AC1–AC3, AC5.
  - The fake agent prints `args=[$*]`.
  - When it gets `--resume` and `$SQUADSTORM_E2E_FAIL_RESUME` is set, it exits 1 at once.
  - For AC5, the fake agent streams output until a marker file exists.
- `README.md` (app): workspaces now come back "with each agent's conversation" (Claude always; Codex when it has its own folder).

## Order of work
1. Provider sessions, `launchArgs` and unit tests.
2. `SpawnRequest` fields, the pty changes and `started`. e2e AC1, AC2.
3. Resume fallback. e2e AC3.
4. Quit guard. e2e AC5.
5. README. Full run, including `smoke.spec.ts` (AC6).

## What this could break
- **Every agent launch:** the argument list changes. `smoke.spec.ts` checks today's args for a *fresh* Claude (`args=[]`), and this change makes them `args=[--session-id <id>]`.

  That assertion has to change with the behaviour. This is a spec'd behaviour change, not a weakened test: the assertion stays exact, with the new expected args. It will be called out in the PR.
- Quitting: the guard must never block quitting when nothing is working. The e2e covers both cases, and `app.close()` in every other e2e test still closes cleanly, because nothing is working at that point.
- The update script (`scripts/update-app.sh`) waits for the app to quit. The guard only adds a prompt when agents are working.

## Riskiest step
Step 2, changing launch arguments for real CLIs. Before wiring it in, the plan's implementer runs both real CLIs once by hand: `claude --session-id <uuid>`, then quit, then `claude --resume <uuid>`; and `codex resume --last` in a folder with one prior session. That confirms the flags behave as `--help` says. The result is recorded in the PR.

## Alternatives rejected
- **Reading Codex's session files** to map sessions to agents: it depends on Codex's internal storage format (the spec's concern 1).
- **Checking for Claude's session file before resuming:** it depends on Claude's internal layout. The fast-exit fallback works for both CLIs without it.

## Proof
- AC1, AC2 → `e2e/resume.spec.ts › claude agents resume their own session`
- AC3 → `› a failed resume starts fresh with a note`
- AC4 → `tests/sessions.test.ts`
- AC5 → `› quitting asks while an agent is working`
- AC6 → `smoke.spec.ts` (with the updated fresh-launch args) and the store test from agent-worktrees
- All → `pnpm typecheck && pnpm test && pnpm test:e2e` output in the PR

## Deviations
