# packages

Shared libraries used by more than one app (UI components, config, utilities…).

Each package lives in its own folder with a `package.json` named `@squadstorm/<name>`, and
apps depend on it with `"@squadstorm/<name>": "workspace:*"`.
