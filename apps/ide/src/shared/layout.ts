import type { AgentConfig } from './types'
import { PROVIDERS, type Provider } from './providers'

/** Near-square grid: 6 agents → 3×2, 4 → 2×2, 5 → 3×2. */
export function gridDimensions(count: number): { cols: number; rows: number } {
  if (count <= 0) return { cols: 1, rows: 1 }
  const cols = Math.ceil(Math.sqrt(count))
  return { cols, rows: Math.ceil(count / cols) }
}

/** Tiles per row, filled row by row; the last row takes the remainder and its tiles stretch: 3 → [2, 1]. */
export function gridRows(count: number): number[] {
  const { cols, rows } = gridDimensions(count)
  return Array.from({ length: rows }, (_, i) => Math.min(cols, count - i * cols)).filter((n) => n > 0)
}

/** `n` equal fractions summing to 1. */
export function evenSplit(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n)
}

/**
 * Moves the divider after `sizes[boundary]` by `delta` (a fraction of the whole). The side it moves
 * into shrinks panel by panel, each down to `min`, so a long drag pushes past the direct neighbor.
 */
export function resizeSplit(sizes: readonly number[], boundary: number, delta: number, min: number): number[] {
  const next = [...sizes]
  if (boundary < 0 || boundary >= next.length - 1 || delta === 0) return next
  const grow = delta > 0 ? boundary : boundary + 1
  const step = delta > 0 ? 1 : -1
  let remaining = Math.abs(delta)
  for (let i = delta > 0 ? boundary + 1 : boundary; i >= 0 && i < next.length && remaining > 0; i += step) {
    const take = Math.min(remaining, Math.max(0, next[i] - min))
    next[i] -= take
    remaining -= take
  }
  next[grow] += Math.abs(delta) - remaining
  return next
}

/** "Claude 3" when Claude 1 and Claude 2 already exist (gaps are not reused). */
export function nextAgentLabel(agents: AgentConfig[], provider: Provider): string {
  const prefix = PROVIDERS[provider].label
  const used = agents
    .filter((a) => a.provider === provider)
    .map((a) => Number(a.label.slice(prefix.length + 1)) || 0)
  return `${prefix} ${Math.max(0, ...used) + 1}`
}

/** Copy of `items` with the element at `from` moved to `to`; out-of-range indices are a no-op. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items]
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}
