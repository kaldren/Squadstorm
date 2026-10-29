import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

const MARKER = '__SQUADSTORM_PATH__'

let cachedPath: Promise<string> | null = null

/**
 * Apps launched from Finder/Dock get a minimal PATH, so CLIs installed in
 * ~/.local/bin or Homebrew are invisible. Ask the user's interactive login
 * shell for its PATH once and reuse it for every agent.
 */
export function shellPath(): Promise<string> {
  cachedPath ??= new Promise((resolve) => {
    const fallback = [
      process.env.PATH ?? '',
      join(homedir(), '.local/bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin'
    ].join(delimiter)

    if (process.platform === 'win32') return resolve(process.env.PATH ?? '')

    const shell = process.env.SHELL || '/bin/zsh'
    execFile(
      shell,
      ['-ilc', `printf '${MARKER}%s${MARKER}' "$PATH"`],
      { timeout: 5000, env: process.env },
      (err, stdout) => {
        const match = !err && stdout.match(new RegExp(`${MARKER}(.*)${MARKER}`))
        resolve(match ? match[1] : fallback)
      }
    )
  })
  return cachedPath
}

/** Like `which`: absolute path of an executable on PATH, or null. */
export function resolveCommand(command: string, path: string): string | null {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, command)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // not in this directory
    }
  }
  return null
}
