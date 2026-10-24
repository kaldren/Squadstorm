import { describe, expect, it } from 'vitest'
import { parseRepo } from '../src/shared/github'

describe('parseRepo', () => {
  it.each([
    'acme/widgets',
    ' acme/widgets ',
    'github.com/acme/widgets',
    'https://github.com/acme/widgets',
    'https://github.com/acme/widgets.git',
    'https://www.github.com/acme/widgets/',
    'https://github.com/acme/widgets/tree/main/src',
    'git@github.com:acme/widgets.git'
  ])('%s → acme/widgets', (input) => {
    expect(parseRepo(input)).toEqual({ owner: 'acme', name: 'widgets' })
  })

  it('keeps dots inside names', () => {
    expect(parseRepo('acme/widgets.js')).toEqual({ owner: 'acme', name: 'widgets.js' })
  })

  it.each(['', 'acme', 'acme/', '../etc', 'acme/..', 'https://gitlab.com/acme/widgets', 'a b/c'])(
    'rejects %j',
    (input) => {
      expect(parseRepo(input)).toBeNull()
    }
  )
})
