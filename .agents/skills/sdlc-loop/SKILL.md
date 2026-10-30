---
name: sdlc-loop
description: The required process for every code change in Squadstorm (intent → spec → plan → code + tests → PR → maintain). Load before writing, editing, planning or reviewing any code, in any app or package, and when a bug, incident or review finding needs to re-enter the process.
---

# The loop

Every change is a chain of committed artifacts: each stage ends by committing one and the next stage starts by reading it. The chain in git is the audit trail: who asked for what, what the agent produced, who accepted it.

Every change lives in `intent/<YYYY-MM-DD>-<slug>/`. **Read that folder first**; the latest artifact tells you which stage you are in. If the folder doesn't exist, start at Plan. The folder is the source of truth; if a GitHub issue exists, link it from `intent.md`. Templates for each artifact are in `templates/`; use them as the skeleton.

| Stage | Artifact | Human gate | Accepting it starts |
|---|---|---|---|
| 1 Plan | `intent.md` | `Status: accepted` (or `rejected`) | Design |
| 2 Design | `spec.md` | `Status: accepted`, every flagged concern resolved | Plan mode |
| 3 Build | `plan.md` | `Status: accepted` before any code | Implementation |
| 4 Test | code + tests | `pnpm typecheck && pnpm test` green, plus `pnpm test:e2e` when UI or IPC changed; output pasted | PR |
| 5 Deploy | PR + review findings | Important findings resolved; the user merges | CI on `main` |
| 6 Maintain | bug / incident / finding → new `intent.md` | Triage: fix now, schedule, dismiss | Stage 1 |

## Hard rules

- Never skip a gate. Never write code without an accepted `plan.md`.
- An artifact is accepted only when its `Status:` line says so. The agent never sets `accepted` on its own; the user does, or says so in as many words.
- Departed from the plan? Record it under Deviations in `plan.md` in the same commit.
- If a test fails, fix the code, not the test. Never skip, weaken or delete a failing test.
- The agent never approves its own work, never merges and never pushes to `main`. Anything that ships (a deploy, a release, a publish) waits for the user's explicit go-ahead in that session.
- Small fix (typo, one-liner): ask the user whether a short `intent.md` alone is enough. If yes, still run stage 4 and open a PR.
- Solo: the user accepts each artifact after a re-read later (e.g. the next day). Don't press for acceptance in the session that produced it.

## 1 Plan → `intent.md`

Intent enters as an idea, a bug report or a finding from stage 6; the steps are the same.

1. Let the originator describe the problem in their own words: what can't be done today, who is affected, what better looks like, what is out of scope.
2. Ask what an analyst would ask (scope, users, constraints, what success looks like) until it is concrete.
3. Write it with `templates/intent.md`, in the originator's terms. Don't prescribe a solution; that is the spec's job.
4. The originator corrects what you misunderstood. Commit as `Status: draft`.

## 2 Design → `spec.md`

Requirements and design are one session, not two phases.

1. Read `intent.md`. Apply the repo's standards as constraints: `AGENTS.md`, the app's `CLAUDE.md`, and any repo skill that applies.
2. Write `templates/spec.md`: requirements traced to the intent, one testable acceptance criterion per requirement, the design, the risk, and **flagged concerns**: every point where a constraint can't be met, two constraints contradict, or an analyst would escalate.
3. Carry every open question from `intent.md` forward: answered, or explicitly still open.
4. Gate: the user checks that the spec solves the stated problem and resolves the flagged concerns first. A spec change after `plan.md` exists goes in the Changelog with its reason.

## 3 Build → `plan.md`, then code

1. Enter plan mode. Read the codebase; change nothing.
2. Write `templates/plan.md` from `intent.md` + `spec.md`: files that change, order of work, what it could break, the riskiest step, alternatives rejected, and proof (the command, test or screenshot that shows each acceptance criterion).
3. The plan is done when an engineer who never saw this conversation could implement it from the file alone.
4. Mark steps that touch disjoint files `[P]`; they may run in parallel worktrees. Steps that share files run in order in one session.
5. Gate: the user accepts. Then implement, in one pass if the plan holds.

## 4 Test

- State the target before coding, checkably: "tests in X pass", "the panel shows Y", "screenshot matches the mock".
- Bug fixes: failing test first. Reproduce the bug as a test, run it, confirm it fails for the expected reason, commit it. Only then fix, without touching the test.
- UI work: run the app (`pnpm dev:ide`) or screenshot it and compare with the mock; two or three rounds is normal.
- Done means `pnpm typecheck && pnpm test` green, plus `pnpm test:e2e` when UI or IPC changed, with the literal output pasted into the PR description.
- Final check in a fresh context: a reviewer that did not write the code (a new session or the code-reviewer agent) reads the diff and reports; it never fixes.

## 5 Deploy → PR

1. Open the PR. The description links `intent/<folder>/`, says how the diff maps to `plan.md`, and pastes the verification output.
2. Review in three passes and tag each finding Important or Nit: **bugs** (logic, edge cases, regressions), **security** (injection, secrets in the diff, missing checks), **compliance** (every acceptance criterion in `spec.md` covered; `plan.md` followed or the deviation recorded; no test weakened; `AGENTS.md` and the app `CLAUDE.md` still accurate). Findings inform the user; they never approve or block on their own.
3. Address Important findings and failing checks until the PR is green and waiting only on the user.
4. A mistake caught for the second time, by review or by the user, goes into the "Things Codex or Claude gets wrong" section of `AGENTS.md` in the same PR.
5. The user merges.

## 6 Maintain → closes the loop

A bug, incident, flaky test or finding too big for the current PR becomes a new `intent.md` (Origin: bug or incident, with the evidence: repro, logs, failing test) and goes through every stage like anything else. Every shipped fix keeps its regression test in the suite.
