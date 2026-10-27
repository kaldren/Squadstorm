import { execFile, spawn } from 'node:child_process'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CloneResult, GithubRepo, GithubStatus } from '@shared/api'
import { parseRepo, repoFullName } from '@shared/github'
import { resolveCommand, shellPath } from './shell-env'

// SQUADSTORM_GIT_BASE swaps github.com for another git host and bypasses gh (e2e tests point it at a
// local folder of repos); SQUADSTORM_REPOS_DIR moves where clones land.
const gitBase = () => process.env.SQUADSTORM_GIT_BASE
const reposDir = () => process.env.SQUADSTORM_REPOS_DIR ?? join(homedir(), 'SquadstormIDE', 'repos')

export async function gitEnv(): Promise<NodeJS.ProcessEnv> {
  // Never let git block on an interactive credential prompt nobody can see.
  return { ...process.env, PATH: await shellPath(), GIT_TERMINAL_PROMPT: '0' }
}

async function ghBinary(): Promise<string | null> {
  return gitBase() ? null : resolveCommand('gh', await shellPath())
}

export function run(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { env, cwd, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) =>
        err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout)
    )
  })
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false
  )

export async function githubStatus(): Promise<GithubStatus> {
  const gh = await ghBinary()
  if (!gh) return { installed: false, user: null }
  try {
    const login = await run(gh, ['api', 'user', '--jq', '.login'], await gitEnv())
    return { installed: true, user: login.trim() || null }
  } catch {
    return { installed: true, user: null }
  }
}

/** The signed-in user's most recently updated repos, including org and collaborator repos. */
export async function listRepos(): Promise<GithubRepo[]> {
  const gh = await ghBinary()
  if (!gh) return []
  const out = await run(
    gh,
    [
      'api',
      'user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member'
    ],
    await gitEnv()
  )
  const repos = JSON.parse(out) as {
    full_name: string
    description: string | null
    private: boolean
    updated_at: string
  }[]
  return repos.map((r) => ({
    fullName: r.full_name,
    description: r.description,
    private: r.private,
    updatedAt: r.updated_at
  }))
}

const inFlight = new Map<string, Promise<CloneResult>>()

/** Clones into the managed repos folder, or reuses an earlier clone of the same repo. */
export function cloneRepo(input: string, onProgress: (line: string) => void): Promise<CloneResult> {
  const ref = parseRepo(input)
  if (!ref) return Promise.reject(new Error(`Not a GitHub repository: ${input}`))
  const dest = join(reposDir(), ref.owner, ref.name)
  let attempt = inFlight.get(dest)
  if (!attempt) {
    attempt = cloneInto(repoFullName(ref), dest, onProgress).finally(() => inFlight.delete(dest))
    inFlight.set(dest, attempt)
  }
  return attempt
}

async function cloneInto(
  fullName: string,
  dest: string,
  onProgress: (line: string) => void
): Promise<CloneResult> {
  if (await exists(join(dest, '.git'))) return { path: dest, reused: true }
  if ((await exists(dest)) && (await readdir(dest)).length > 0) {
    throw new Error(`${dest} already exists and is not a git repository.`)
  }
  await mkdir(dirname(dest), { recursive: true })

  const env = await gitEnv()
  const base = gitBase()
  // gh clones with the user's GitHub login, so private repos work without git credentials.
  const useGh = !base && (await githubStatus()).user !== null
  const gh = useGh ? await ghBinary() : null
  const [file, args] = gh
    ? [gh, ['repo', 'clone', fullName, dest, '--', '--progress']]
    : [
        resolveCommand('git', env.PATH ?? '') ?? 'git',
        ['clone', '--progress', `${base ?? 'https://github.com'}/${fullName}.git`, dest]
      ]

  const tail: string[] = []
  const code = await new Promise<number>((resolve, reject) => {
    const proc = spawn(file, args, { env })
    proc.on('error', reject)
    // git redraws progress with \r, so treat both \r and \n as line breaks.
    proc.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split(/[\r\n]+/)) {
        if (!line.trim()) continue
        onProgress(line.trim())
        tail.push(line.trim())
        if (tail.length > 20) tail.shift()
      }
    })
    proc.on('close', (c) => resolve(c ?? 1))
  })

  if (code !== 0) {
    await rm(dest, { recursive: true, force: true })
    const reason = tail.filter((l) => /fatal|error|denied|not found/i.test(l)).pop() ?? tail.pop()
    throw new Error(`Could not clone ${fullName}${reason ? `: ${reason}` : '.'}`)
  }
  return { path: dest, reused: false }
}
