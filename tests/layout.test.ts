import { describe, expect, it } from 'vitest'
import { evenSplit, gridDimensions, gridRows, moveItem, nextAgentLabel, resizeSplit } from '../src/shared/layout'
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

describe('gridRows', () => {
  it.each([
    [1, [1]],
    [2, [2]],
    [3, [2, 1]],
    [5, [3, 2]],
    [7, [3, 3, 1]],
    [9, [3, 3, 3]]
  ])('%i agents → %j', (n, rows) => {
    expect(gridRows(n)).toEqual(rows)
  })
})

describe('resizeSplit', () => {
  const close = (actual: number[], expected: number[]) =>
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]))

  it('trades size between the two neighbors of the divider', () => {
    close(resizeSplit([0.5, 0.5], 0, 0.2, 0.1), [0.7, 0.3])
    close(resizeSplit([0.5, 0.5], 0, -0.2, 0.1), [0.3, 0.7])
  })

  it('pushes further panels once the neighbor hits the minimum', () => {
    close(resizeSplit(evenSplit(3), 0, 0.4, 0.1), [1 / 3 + 0.4, 0.1, 1 - (1 / 3 + 0.4) - 0.1])
    close(resizeSplit(evenSplit(3), 1, -0.4, 0.1), [1 - (1 / 3 + 0.4) - 0.1, 0.1, 1 / 3 + 0.4])
  })

  it('stops when everything on that side is at the minimum', () => {
    close(resizeSplit([0.5, 0.5], 0, 0.9, 0.1), [0.9, 0.1])
  })

  it('ignores a divider that does not exist', () => {
    expect(resizeSplit([0.5, 0.5], 1, 0.1, 0.1)).toEqual([0.5, 0.5])
  })
})
