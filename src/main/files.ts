import { watch, type FSWatcher } from 'node:fs'
import { open, readdir, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { isHidden, isWatched, sortEntries, type FileEntry, type ReadResult } from '@shared/files'

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
