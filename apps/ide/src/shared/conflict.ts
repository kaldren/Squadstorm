export type DiskChange = 'none' | 'in-sync' | 'reload' | 'conflict'

/**
 * What to do when an open file is found on disk with content `disk` (null when it was deleted).
 * `saved` is the disk content the buffer was loaded from or last acknowledged (null once a deletion
 * was acknowledged); `buffer` is what the editor holds now.
 */
export function diskChange({ saved, buffer, disk }: { saved: string | null; buffer: string; disk: string | null }): DiskChange {
  if (disk === saved) return 'none'
  // Someone wrote exactly what the editor has; adopt it without asking.
  if (disk === buffer) return 'in-sync'
  if (buffer === saved) return disk === null ? 'none' : 'reload'
  return 'conflict'
}
