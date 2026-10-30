# Squadstorm IDE

Electron macOS app that runs coding agents side by side.

## Commands (from the repo root)
- Dev: `pnpm dev:ide`
- Unit: `pnpm --filter squadstorm-ide test` (Vitest, `tests/`)
- E2E: `pnpm --filter squadstorm-ide test:e2e` (Playwright, `e2e/`). Run it when UI or IPC changes.

## Architecture (`src/`)
- `main/`: Electron main process (pty, git, GitHub, files, search, store)
- `preload/`: the IPC bridge
- `renderer/`: the UI
- `shared/`: types and the IPC contract (`api.ts`) used by every process
