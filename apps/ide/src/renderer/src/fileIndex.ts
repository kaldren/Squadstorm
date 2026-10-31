/**
 * The files of a folder, shared by everything that needs to know whether a path exists there (agent
 * tiles turning printed paths into links). The folder is watched while anyone uses it, and the list
 * is re-read after changes, so files an agent creates become links too.
 */
interface Entry {
  users: number
  files: Set<string> | null
  timer?: ReturnType<typeof setTimeout>
  off(): void
}

const entries = new Map<string, Entry>()

export interface FileIndex {
  /** Null until the first listing arrives. */
  has(path: string): boolean | null
  dispose(): void
}

export function openFileIndex(root: string): FileIndex {
  let entry = entries.get(root)
  if (!entry) {
    const created: Entry = { users: 0, files: null, off: () => {} }
    const load = () =>
      window.api.files.all(root).then(
        (all) => void (created.files = new Set(all)),
        () => {}
      )
    window.api.files.watch(root)
    created.off = window.api.files.onChanged((changed) => {
      if (changed !== root) return
      clearTimeout(created.timer)
      created.timer = setTimeout(load, 300)
    })
    void load()
    entries.set(root, created)
    entry = created
  }
  entry.users++
  const mine = entry
  let disposed = false
  return {
    has: (path) => (mine.files ? mine.files.has(path) : null),
    dispose() {
      if (disposed) return
      disposed = true
      if (--mine.users > 0) return
      clearTimeout(mine.timer)
      mine.off()
      window.api.files.unwatch(root)
      entries.delete(root)
    }
  }
}
