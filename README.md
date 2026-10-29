<div align="center">

<img src="apps/ide/build/icon.png" width="112" alt="Squadstorm icon" />

# Squadstorm

**[squadstorm.ai](https://squadstorm.ai)**

</div>

This is the Squadstorm monorepo. Every Squadstorm product and the code they share live here.

## Products

| App | What it is |
| --- | --- |
| [**Squadstorm IDE**](apps/ide) | A lightweight, AI-first macOS IDE that runs a squad of coding agents side by side. |

## Layout

```
apps/        # Products you ship: each one is its own workspace package
└── ide/     # The Squadstorm desktop app (Electron)
packages/    # Libraries shared between apps, named @squadstorm/<name>
```

## Getting started

You need **Node.js 26** and **pnpm**.

```bash
git clone https://github.com/kaldren/Squadstorm.git
cd Squadstorm
pnpm install       # installs every workspace
pnpm dev:ide       # runs the IDE in development
```

Commands at the root run across every workspace:

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

To run something in one app only, use a filter, for example `pnpm --filter squadstorm-ide build`, or `cd` into the app and run its scripts there.

## Adding a new product or package

1. Create `apps/<name>` (or `packages/<name>`) with its own `package.json`.
2. Give shared packages the name `@squadstorm/<name>` and depend on them with `"workspace:*"`.
3. Extend `../../tsconfig.base.json` from the new `tsconfig.json`.
4. Add `typecheck` and `test` scripts so the root commands and CI pick it up.
5. Run `pnpm install` at the root.
