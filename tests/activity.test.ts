import { describe, expect, it } from 'vitest'
import { ActivityTracker, ECHO_MS, ONLINE_MS, QUIET_MS } from '../src/shared/activity'

/** Feeds output every 100ms over [from, to). */
function stream(t: ActivityTracker, from: number, to: number) {
  for (let now = from; now < to; now += 100) t.output(now)
}

describe('ActivityTracker', () => {
  it('is online after start, then idle', () => {
    const t = new ActivityTracker(0)
    expect(t.status(ONLINE_MS - 1)).toBe('online')
    expect(t.status(ONLINE_MS)).toBe('idle')
  })

  it('works while output streams, then is online again for the full window', () => {
    const t = new ActivityTracker(0)
    stream(t, 200_000, 210_000)
    expect(t.status(205_000)).toBe('working')
    expect(t.status(209_900 + QUIET_MS - 1)).toBe('working')
    expect(t.status(209_900 + QUIET_MS)).toBe('online')
    expect(t.status(209_900 + ONLINE_MS - 1)).toBe('online')
    expect(t.status(209_900 + ONLINE_MS)).toBe('idle')
  })

  it('ignores a one-off redraw', () => {
    const t = new ActivityTracker(0)
    stream(t, 200_000, 200_300)
    expect(t.status(200_300)).toBe('idle')
  })

  it('ignores echo of typing', () => {
    const t = new ActivityTracker(0)
    for (let now = 200_000; now < 205_000; now += 100) {
      t.input(now)
      t.output(now + ECHO_MS - 50)
    }
    expect(t.status(205_000)).toBe('idle')
  })
})
