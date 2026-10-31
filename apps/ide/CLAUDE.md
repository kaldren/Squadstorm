# Squadstorm IDE

Electron macOS app that runs coding agents side by side.

## Commands (from the repo root)
- Dev: `pnpm dev:ide`
- Unit: `pnpm --filter squadstorm-ide test` (Vitest, `tests/`)
- E2E: `pnpm --filter squadstorm-ide test:e2e` (Playwright, `e2e/`). Run it at the end of every change. It runs invisibly (the window is never shown, no Dock icon); `SQUADSTORM_E2E_SHOW=1` shows it to watch a run.

## Architecture (`src/`)
- `main/`: Electron main process (pty, git, GitHub, files, search, store)
- `preload/`: the IPC bridge
- `renderer/`: the UI
- `shared/`: types and the IPC contract (`api.ts`) used by every process
