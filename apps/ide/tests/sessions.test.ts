import { describe, expect, it } from 'vitest'
import { launchArgs } from '../src/shared/providers'

const id = '31496954-ab1f-4738-b08f-d37e91694630'

describe('launchArgs', () => {
  it('starts Claude on its own session and resumes exactly that one', () => {
    expect(launchArgs('claude', 'fresh', { id, soleInFolder: false })).toEqual({ args: ['--session-id', id], mode: 'fresh' })
    expect(launchArgs('claude', 'resume', { id, soleInFolder: false })).toEqual({ args: ['--resume', id], mode: 'resume' })
  })

  it('resumes a Codex agent that is alone in its folder, subcommand first', () => {
    expect(launchArgs('codex', 'resume', { id, soleInFolder: true })).toEqual({
      args: ['resume', '--last', '--no-alt-screen'],
      mode: 'resume'
    })
  })

  it('starts Codex agents that share a folder fresh', () => {
    expect(launchArgs('codex', 'resume', { id, soleInFolder: false })).toEqual({ args: ['--no-alt-screen'], mode: 'fresh' })
  })

  it('starts a Codex agent that never ran fresh', () => {
    expect(launchArgs('codex', 'fresh', { id, soleInFolder: true })).toEqual({ args: ['--no-alt-screen'], mode: 'fresh' })
  })

  it('leaves terminals alone', () => {
    expect(launchArgs('terminal', 'resume', { id, soleInFolder: true })).toEqual({ args: ['-l'], mode: 'fresh' })
  })
})

describe('session ids', () => {
  it('never passes an id that is not a UUID (it could read as a flag)', () => {
    expect(launchArgs('claude', 'resume', { id: '--mcp-config=/x.json', soleInFolder: true })).toEqual({ args: [], mode: 'fresh' })
  })
})
