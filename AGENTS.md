# Squadstorm

Squadstorm is an AI software development company that builds software products.
It organizes its work in a pnpm monorepo, with apps in the `apps/` directory and libraries in the `packages/` directory.

## Before writing any code
Load the `sdlc-loop` skill and follow it. It covers every change, in every app or package.

## Commands (run from the repo root, across all workspaces)
- `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`
- Every change ends with `pnpm typecheck && pnpm test && pnpm test:e2e`, all green. The e2e suite runs invisibly, so it never takes over the screen.

## Things Codex or Claude gets wrong
<!-- If Codex or Claude makes the same mistake twice, add the correction here, or in the app's AGENTS.md if only that app is affected. -->
