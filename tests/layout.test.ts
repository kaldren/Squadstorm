import { describe, expect, it } from 'vitest'
import { gridDimensions, moveItem, nextAgentLabel } from '../src/shared/layout'
import type { AgentConfig } from '../src/shared/types'

describe('gridDimensions', () => {
  it.each([
    [1, 1, 1],
    [2, 2, 1],
    [4, 2, 2],
    [5, 3, 2],
    [6, 3, 2],
    [9, 3, 3],
    [10, 4, 3]
  ])('%i agents → %i×%i', (n, cols, rows) => {
    expect(gridDimensions(n)).toEqual({ cols, rows })
  })
})

describe('nextAgentLabel', () => {
  const agent = (provider: AgentConfig['provider'], label: string): AgentConfig => ({
    id: label,
    provider,
    label
  })

  it('numbers per provider', () => {
    const agents = [agent('claude', 'Claude 1'), agent('codex', 'Codex 1')]
    expect(nextAgentLabel(agents, 'claude')).toBe('Claude 2')
    expect(nextAgentLabel([], 'codex')).toBe('Codex 1')
  })

  it('does not reuse a removed number', () => {
    expect(nextAgentLabel([agent('claude', 'Claude 3')], 'claude')).toBe('Claude 4')
  })
})

describe('moveItem', () => {
  it('moves forward and backward', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('ignores out-of-range indices without mutating the input', () => {
    const items = ['a', 'b']
    expect(moveItem(items, 0, 5)).toEqual(['a', 'b'])
    expect(moveItem(items, -1, 0)).toEqual(['a', 'b'])
    expect(items).toEqual(['a', 'b'])
  })
})
