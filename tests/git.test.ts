import { describe, expect, it } from 'vitest'
import { parseLog, parseNameStatus, parseStatus } from '../src/shared/git'

const z = (...records: string[]) => records.join('\0') + '\0'

describe('parseStatus', () => {
  it('reads branch, upstream and ahead/behind', () => {
    const s = parseStatus(z('## main...origin/main [ahead 2, behind 1]'))
    expect(s).toMatchObject({ repo: true, branch: 'main', upstream: true, ahead: 2, behind: 1, changes: [] })
  })

  it('handles branches without upstream, dotted names and fresh repos', () => {
    expect(parseStatus(z('## feature/v1.2')).branch).toBe('feature/v1.2')
    expect(parseStatus(z('## feature/v1.2')).upstream).toBe(false)
    expect(parseStatus(z('## No commits yet on main')).branch).toBe('main')
    expect(parseStatus(z('## HEAD (no branch)')).branch).toBeNull()
  })

  it('classifies changes and follows renames', () => {
    const s = parseStatus(
      z('## main', ' M src/a.ts', 'M  b.ts', '?? new file.ts', 'A  added.ts', ' D gone.ts', 'R  to.ts', 'from.ts', 'UU conflict.ts')
    )
    expect(s.changes).toEqual([
      { path: 'src/a.ts', kind: 'M' },
      { path: 'b.ts', kind: 'M' },
      { path: 'new file.ts', kind: 'A' },
      { path: 'added.ts', kind: 'A' },
      { path: 'gone.ts', kind: 'D' },
      { path: 'to.ts', kind: 'R', from: 'from.ts' },
      { path: 'conflict.ts', kind: 'C' }
    ])
  })
})

describe('parseLog', () => {
  it('reads commits with refs and odd subjects', () => {
    const out =
      ['abc123', 'abc', 'Ada', '1700000000', 'HEAD -> main, origin/main, tag: v1', 'Fix: a, b; c'].join('\x1f') +
      '\0\n' +
      ['def456', 'def', 'Bob', '1690000000', '', 'init'].join('\x1f') +
      '\0'
    expect(parseLog(out)).toEqual([
      { hash: 'abc123', shortHash: 'abc', author: 'Ada', date: 1700000000000, refs: ['HEAD -> main', 'origin/main', 'tag: v1'], subject: 'Fix: a, b; c' },
      { hash: 'def456', shortHash: 'def', author: 'Bob', date: 1690000000000, refs: [], subject: 'init' }
    ])
  })
})

describe('parseNameStatus', () => {
  it('reads changes, renames and copies', () => {
    expect(parseNameStatus(z('M', 'src/a.ts', 'A', 'new.ts', 'D', 'gone.ts', 'R087', 'old.ts', 'moved.ts', 'C100', 'x.ts', 'y.ts'))).toEqual([
      { path: 'src/a.ts', kind: 'M' },
      { path: 'new.ts', kind: 'A' },
      { path: 'gone.ts', kind: 'D' },
      { path: 'moved.ts', kind: 'R', from: 'old.ts' },
      { path: 'y.ts', kind: 'A', from: 'x.ts' }
    ])
    expect(parseNameStatus('')).toEqual([])
  })
})
