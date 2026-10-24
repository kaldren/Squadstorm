export interface RepoRef {
  owner: string
  name: string
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/

/**
 * Accepts `owner/name`, `https://github.com/owner/name[.git][/…]` or
 * `git@github.com:owner/name.git`. Segments are restricted to GitHub's
 * allowed characters, which also keeps them safe to use as folder names.
 */
export function parseRepo(input: string): RepoRef | null {
  const match = input
    .trim()
    .match(
      /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/|git@github\.com:)?([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/
    )
  if (!match) return null
  const [, owner, name] = match
  const valid = (s: string) => SEGMENT.test(s) && s !== '.' && s !== '..'
  return valid(owner) && valid(name) ? { owner, name } : null
}

export const repoFullName = (ref: RepoRef) => `${ref.owner}/${ref.name}`
