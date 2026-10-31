import { watch, type FSWatcher } from 'node:fs'
import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { isHidden, isSearched, isWatched, sortEntries, type FileEntry, type ReadResult } from '@shared/files'

const MAX_EDITABLE_BYTES = 2 * 1024 * 1024

/** Resolves a renderer-supplied relative path, refusing anything that escapes the root. */
export function resolveInside(root: string, path: string): string {
  const full = resolve(root, path)
  const rel = relative(root, full)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path is outside the workspace: ${path}`)
  return full
}

const toPosix = (path: string) => path.split(sep).join('/')

export async function listDir(root: string, dir: string): Promise<FileEntry[]> {
  const dirents = await readdir(resolveInside(root, dir), { withFileTypes: true })
  return sortEntries(
    dirents
      .filter((d) => !isHidden(d.name))
      .map((d) => ({
        name: d.name,
        path: dir ? `${dir}/${d.name}` : d.name,
        dir: d.isDirectory()
      }))
  )
}

/** Every file under the root, for searching outside a git repo. Stops at `limit` files. */
export async function walkFiles(root: string, limit = 20_000): Promise<string[]> {
  const files: string[] = []
  const queue = ['']
  while (queue.length > 0 && files.length < limit) {
    const dir = queue.shift()!
    const dirents = await readdir(resolveInside(root, dir), { withFileTypes: true }).catch(() => [])
    for (const d of dirents) {
      if (isHidden(d.name) || !isSearched(d.name)) continue
      const path = dir ? `${dir}/${d.name}` : d.name
      if (d.isDirectory()) queue.push(path)
      else if (files.length < limit) files.push(path)
    }
  }
  return files
}

export async function readText(root: string, path: string): Promise<ReadResult> {
  const full = resolveInside(root, path)
  const { size } = await stat(full)
  if (size > MAX_EDITABLE_BYTES) return { error: 'File is too large to edit here.' }
  const handle = await open(full)
  try {
    const buffer = await handle.readFile()
    // Same heuristic git uses: a NUL byte near the start means binary.
    if (buffer.subarray(0, 8000).includes(0)) return { error: 'Binary file — not shown.' }
    return { content: buffer.toString('utf8') }
  } finally {
    await handle.close()
  }
}

export async function writeText(root: string, path: string, content: string): Promise<void> {
  await writeFile(resolveInside(root, path), content)
}

/**
 * Writes `content` only if the file still holds exactly `expected` (null: doesn't exist), as UTF-8
 * text. Used where a stale view would otherwise overwrite something an agent just wrote.
 */
export async function writeTextIfUnchanged(root: string, path: string, expected: string | null, content: string): Promise<void> {
  const full = resolveInside(root, path)
  const buffer = await readFile(full).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null
    throw e
  })
  const current = buffer?.toString('utf8') ?? null
  if (buffer && !Buffer.from(current!, 'utf8').equals(buffer)) {
    throw new Error(`${path} isn't UTF-8 text, so it can't be changed line by line. Discard the whole file instead.`)
  }
  if (current !== expected) throw new Error(`${path} changed on disk in the meantime, so nothing was written. Look again and retry.`)
  await writeFile(full, content)
}

/**
 * One recursive watcher per root, shared by every subscriber. Changes are batched so an
 * agent rewriting many files produces one refresh, not hundreds.
 */
export class FileWatchers {
  private watchers = new Map<string, { watcher: FSWatcher; refs: number }>()
  private pending = new Map<string, Set<string>>()
  private timer: NodeJS.Timeout | null = null

  constructor(private send: (root: string, paths: string[]) => void) {}

  watch(root: string): void {
    const existing = this.watchers.get(root)
    if (existing) {
      existing.refs++
      return
    }
    try {
      const watcher = watch(root, { recursive: true }, (_event, file) => {
        if (file && isWatched(file)) this.queue(root, toPosix(file))
      })
      watcher.on('error', () => this.close(root))
      this.watchers.set(root, { watcher, refs: 1 })
    } catch {
      // Missing folder: the tree shows the error; nothing to watch.
    }
  }

  unwatch(root: string): void {
    const entry = this.watchers.get(root)
    if (entry && --entry.refs <= 0) this.close(root)
  }

  closeAll(): void {
    for (const root of [...this.watchers.keys()]) this.close(root)
  }

  private close(root: string): void {
    this.watchers.get(root)?.watcher.close()
    this.watchers.delete(root)
  }

  private queue(root: string, path: string): void {
    const paths = this.pending.get(root) ?? new Set()
    paths.add(path)
    this.pending.set(root, paths)
    this.timer ??= setTimeout(() => {
      this.timer = null
      for (const [r, ps] of this.pending) this.send(r, [...ps])
      this.pending.clear()
    }, 150)
  }
}
