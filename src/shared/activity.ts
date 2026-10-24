export type Activity = 'online' | 'idle' | 'working'

/** How long an agent counts as online after it starts or finishes working. */
export const ONLINE_MS = 2 * 60_000
/** Output silence that ends a working stretch. */
export const QUIET_MS = 3_000
/** Output must keep arriving this long to count as work, so one-off redraws don't. */
export const SUSTAIN_MS = 600
/** Output this soon after a keystroke or resize is treated as echo/redraw, not work. */
export const ECHO_MS = 250

/**
 * Infers what an agent is doing from its terminal traffic. Agent CLIs animate a spinner
 * while working and go quiet when waiting for input, so sustained output means "working".
 */
export class ActivityTracker {
  private since: number
  private lastInput = -Infinity
  private lastOutput = -Infinity
  private burstStart = -Infinity
  private lastWorked = -Infinity

  constructor(now: number) {
    this.since = now
  }

  /** Keystrokes, focus reports and resizes all make the agent redraw. */
  input(now: number): void {
    this.lastInput = now
  }

  output(now: number): void {
    if (now - this.lastInput < ECHO_MS) return
    if (now - this.lastOutput >= QUIET_MS) this.burstStart = now
    this.lastOutput = now
    if (now - this.burstStart >= SUSTAIN_MS) this.lastWorked = now
  }

  status(now: number): Activity {
    if (now - this.lastWorked < QUIET_MS) return 'working'
    return now - Math.max(this.since, this.lastWorked) < ONLINE_MS ? 'online' : 'idle'
  }
}
