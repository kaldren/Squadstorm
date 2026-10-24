import type { AgentConfig } from './types'
import { PROVIDERS, type Provider } from './providers'

/** Near-square grid: 6 agents → 3×2, 4 → 2×2, 5 → 3×2. */
export function gridDimensions(count: number): { cols: number; rows: number } {
  if (count <= 0) return { cols: 1, rows: 1 }
  const cols = Math.ceil(Math.sqrt(count))
  return { cols, rows: Math.ceil(count / cols) }
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
