import { describe, expect, it } from 'vitest'
import { diskChange } from '../src/shared/conflict'

describe('diskChange', () => {
  it('does nothing when the disk still matches what was loaded', () => {
    expect(diskChange({ saved: 'a', buffer: 'a', disk: 'a' })).toBe('none')
    expect(diskChange({ saved: 'a', buffer: 'mine', disk: 'a' })).toBe('none')
  })

  it('reloads a clean buffer when the disk changes', () => {
    expect(diskChange({ saved: 'a', buffer: 'a', disk: 'agent' })).toBe('reload')
  })

  it('flags a conflict when a dirty buffer meets a changed disk', () => {
    expect(diskChange({ saved: 'a', buffer: 'mine', disk: 'agent' })).toBe('conflict')
  })

  it('treats a disk that already has the buffer as saved', () => {
    expect(diskChange({ saved: 'a', buffer: 'same', disk: 'same' })).toBe('in-sync')
  })

  it('handles a deleted file: a conflict when dirty, nothing when clean', () => {
    expect(diskChange({ saved: 'a', buffer: 'mine', disk: null })).toBe('conflict')
    expect(diskChange({ saved: 'a', buffer: 'a', disk: null })).toBe('none')
  })

  it('lets a save through once the deletion was acknowledged', () => {
    expect(diskChange({ saved: null, buffer: 'mine', disk: null })).toBe('none')
  })

  it('flags a file that reappears after an acknowledged deletion', () => {
    expect(diskChange({ saved: null, buffer: 'mine', disk: 'agent' })).toBe('conflict')
  })
})
