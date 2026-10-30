import { describe, expect, it } from 'vitest'
import { attentionCounts, nextWaiting } from '../src/shared/attention'

const base = {
  shell: false,
  prev: 'online',
  activity: 'online',
  signal: null,
  replaying: false,
  seen: false,
  waiting: false
} as const

describe('nextWaiting', () => {
  it('waits when an unseen agent stops working', () => {
    expect(nextWaiting({ ...base, prev: 'working', activity: 'online' })).toBe(true)
  })

  it('does not wait when you are looking at the agent', () => {
    expect(nextWaiting({ ...base, prev: 'working', activity: 'online', seen: true })).toBe(false)
    expect(nextWaiting({ ...base, signal: 'bell', seen: true })).toBe(false)
  })

  it('stops waiting once seen', () => {
    expect(nextWaiting({ ...base, waiting: true, seen: true })).toBe(false)
  })

  it('keeps waiting until seen', () => {
    expect(nextWaiting({ ...base, waiting: true, prev: 'online', activity: 'idle' })).toBe(true)
  })

  it('does not wait while still working or without a transition', () => {
    expect(nextWaiting({ ...base, prev: 'working', activity: 'working' })).toBe(false)
    expect(nextWaiting({ ...base, prev: 'online', activity: 'idle' })).toBe(false)
  })

  it('waits on a bell or OSC 9 notification', () => {
    expect(nextWaiting({ ...base, signal: 'bell' })).toBe(true)
    expect(nextWaiting({ ...base, signal: 'osc' })).toBe(true)
  })

  it('ignores activity transitions of plain terminals, but not their bell', () => {
    expect(nextWaiting({ ...base, shell: true, prev: 'working', activity: 'online' })).toBe(false)
    expect(nextWaiting({ ...base, shell: true, signal: 'bell' })).toBe(true)
  })

  it('ignores signals replayed from the backlog', () => {
    expect(nextWaiting({ ...base, signal: 'bell', replaying: true })).toBe(false)
  })
})

describe('attentionCounts', () => {
  it('counts working and waiting agents of a workspace only', () => {
    const agents = {
      a: { activity: 'working', waiting: false },
      b: { activity: 'online', waiting: true },
      c: { activity: 'idle', waiting: false },
      other: { activity: 'working', waiting: true }
    } as const
    expect(attentionCounts(['a', 'b', 'c', 'missing'], agents)).toEqual({ working: 1, waiting: 1 })
  })
})
