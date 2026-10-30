# Spec: Agents resume their conversations after a restart

From: intent/2026-10-30-resume-agents/intent.md. Status: draft.
Standards applied: AGENTS.md, apps/ide/CLAUDE.md, sdlc-loop skill.
Checked: Claude Code 2.1.314 (`--session-id <uuid>`, `-r/--resume <id>`); Codex 0.166 (`codex resume [id] [--last]`; the resume picker and `--last` are filtered to the current folder unless `--all`; there is no flag to choose a session id at start).

## Requirements
1. R1: A Claude agent resumes its own conversation after the app restarts, and when its tile is restarted. (Intent outcome 1; success criterion 1.)
2. R2: A Codex agent resumes its own conversation when Squadstorm can identify it without guessing. (Intent outcome 1; success criterion 2; constraint "never another agent's".)
3. R3: When a conversation can't be resumed, the agent starts fresh, and the tile prints a one-line note saying so. (Intent outcome 2.)
4. R4: Quitting, or closing the window, while any agent is working asks first. Cancelling keeps everything running. With nothing working, it quits at once. (Intent outcome 3; constraint.)
5. R5: Terminal tiles and saved state from before this change behave as today. (Intent constraints.)

## Acceptance criteria
- AC1 (R1): e2e `e2e/resume.spec.ts › claude agents resume their own session`:
  - The fake agent prints its arguments.
  - On first launch, each Claude tile's agent got `--session-id <its agent id>`.
  - After quitting and relaunching, each one got `--resume <its own agent id>`, never another tile's.
- AC2 (R1): same test: a tile's Restart button (after the fake agent exits) also passes `--resume <id>`.
- AC3 (R3): e2e: the fake agent exits with code 1 within a second when it gets `--resume`. The tile then starts it again with `--session-id <id>` and prints `[Couldn't resume the previous conversation; started a new one]`.
- AC4 (R2): unit tests `tests/sessions.test.ts`:
  - A Codex agent alone in its folder (its own worktree, or the only Codex agent in the workspace) resumes with `resume --last`.
  - Two Codex agents sharing a folder start fresh.
  - A Codex agent that never started starts fresh.
- AC5 (R4): e2e `› quitting asks while an agent is working`:
  - While a fake agent streams output, `app.quit()` shows the confirmation (the e2e stubs `dialog.showMessageBoxSync` and records the call).
  - Answering Cancel keeps the app and the agent running.
  - Once the agent is quiet, quitting closes without asking.
- AC6 (R5): `smoke.spec.ts` passes unchanged. Terminal tiles get no session arguments, and saved state without the new field loads.

## Design
**State:** `AgentConfig.started?: boolean` is set once the agent's first spawn succeeds. It tells "new" from "resume" across restarts. Optional, so old state loads (R5).

**Provider sessions** (`src/shared/providers.ts`): `ProviderInfo.session?(ctx) → { fresh: string[]; resume: string[] | null }`.
- **Claude:** fresh `['--session-id', id]`, resume `['--resume', id]`. The agent id is already a v4 UUID (`stores/workspaces.ts`).
- **Codex:** fresh `[]`. Resume `['resume', '--last']` only when `ctx.soleInFolder` is true, otherwise `null`, which means start fresh.
  - `soleInFolder` is computed in the renderer: no other Codex agent has the same cwd (with agent-worktrees, each isolated agent has its own cwd).
  - Codex's own subcommand comes before its other args: `codex resume --last --no-alt-screen`.
- **Terminal:** no `session`, so behaviour is unchanged.

**Spawning** (`SpawnRequest` gains `mode: 'fresh' | 'resume'` and `soleInFolder`):
- The renderer asks for `resume` when `agent.started` is set, and `fresh` otherwise.
- The main process builds the args.
- If a `resume` process exits with a non-zero code within 3 s, `PtyManager` restarts it once with the fresh args. It writes the R3 note into the stream so the tile shows it.

**Restart button:** a resume, same as a relaunch.

**Quit guard** (`src/main/index.ts`):
- The renderer already reports attention to main for the badge. It also reports the working count (`attention:working`).
- The window `close` event and `before-quit` check it. When it's above zero, `dialog.showMessageBoxSync` asks "N agents are working. Quit anyway?" (Quit / Cancel). Cancel calls `preventDefault()`.
- A flag avoids asking twice when quit closes the window.

## Flagged concerns
- [ ] **Codex in a shared folder starts fresh** instead of guessing. `--last` would pick whichever Codex session in that folder ran last, possibly another agent's or one you ran yourself. Proposed: accept. With agent-worktrees, isolated Codex agents resume reliably. Alternative: read Codex's session files to match sessions to agents. That's fragile, because it depends on Codex's internal storage format.
- [ ] **Even a sole Codex agent can resume the wrong conversation** if you ran `codex` yourself in the same folder after it. Proposed: accept, and mention it in the README.
- [ ] **The resume fallback is inferred from a fast non-zero exit.** A CLI that fails to start for another reason (bad auth, for example) also triggers one fresh retry. Proposed: accept. It's a single retry, and the error output stays visible.
- [ ] **Closing the window, not only quitting, gets the guard,** because closing the window stops the agents too. Proposed: yes.

## Risk
Low to medium. It changes how agent CLIs are started. A wrong arguments list would stop agents from starting, which the e2e tests catch for both providers. The quit guard can't trap the user: Quit always remains an option. No data written beyond one optional state field.

## Open questions
From intent.md:
- Use the agent id as the Claude session id? **Answered:** yes.
- How do we learn Codex session ids? **Answered:** we don't. We resume only when the folder makes it unambiguous (R2; concern 1).
- What does Restart do? **Answered:** resume.
- Does closing the window get the guard too? **Proposed:** yes (concern 4).

## Changelog
