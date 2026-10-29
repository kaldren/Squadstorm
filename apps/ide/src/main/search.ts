import { readFile, stat } from 'node:fs/promises'
import { buildRegExp, MAX_RESULTS, pathFilter, searchText, type FileResult, type SearchQuery, type SearchResult } from '@shared/search'
import { resolveInside, walkFiles } from './files'
import { gitFiles } from './git'

const MAX_SEARCHED_BYTES = 2 * 1024 * 1024
const PARALLEL_READS = 32

/** Every file in the workspace, honoring .gitignore when it is a git repo. */
export const allFiles = (root: string) => gitFiles(root).catch(() => walkFiles(root))

async function readSearchable(root: string, path: string): Promise<string | null> {
  try {
    const full = resolveInside(root, path)
    if ((await stat(full)).size > MAX_SEARCHED_BYTES) return null
    const buffer = await readFile(full)
    // Same binary heuristic as the editor.
    return buffer.subarray(0, 8000).includes(0) ? null : buffer.toString('utf8')
  } catch {
    return null
  }
}

/**
 * Searches file contents. `cancelled` is polled between files so a newer search (the user
 * is still typing) stops this one early; the result is then thrown away.
 */
export async function searchWorkspace(root: string, query: SearchQuery, cancelled: () => boolean = () => false): Promise<SearchResult> {
  if (!query.pattern) return { files: [], truncated: false }
  const regex = buildRegExp(query)
  const filter = pathFilter(query.include, query.exclude)
  const paths = (await allFiles(root)).filter(filter).sort()
  const found = new Map<string, FileResult>()
  let total = 0
  let next = 0

  const worker = async () => {
    while (next < paths.length && total < MAX_RESULTS && !cancelled()) {
      const path = paths[next++]
      const content = await readSearchable(root, path)
      if (content === null || total >= MAX_RESULTS) continue
      // Each worker gets its own regex: lastIndex is shared state.
      const matches = searchText(content, new RegExp(regex), MAX_RESULTS - total)
      if (matches.length === 0) continue
      total += matches.length
      found.set(path, { path, matches })
    }
  }
  await Promise.all(Array.from({ length: PARALLEL_READS }, worker))
  // Workers finish out of order; report files in path order.
  const files = paths.flatMap((p) => found.get(p) ?? [])
  return { files, truncated: total >= MAX_RESULTS }
}
