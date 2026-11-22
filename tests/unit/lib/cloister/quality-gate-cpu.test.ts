import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  clearQueueCpuBlock,
  markQueueCpuBlocked,
  QUEUE_CPU_MARKER_FILE,
  readQueueCpuBlockedSince,
} from '../../../../src/lib/cloister/quality-gate-cpu.js'

const roots: string[] = []

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'quality-gate-cpu-'))
  roots.push(path)
  return path
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('queue CPU marker (PAN-5588)', () => {
  it('markQueueCpuBlocked writes {since} when no marker exists', async () => {
    const rootDir = root()
    await markQueueCpuBlocked(rootDir, 5)
    expect(await readQueueCpuBlockedSince(rootDir)).toBe(5)
  })

  it('markQueueCpuBlocked keeps an existing valid marker', async () => {
    const rootDir = root()
    await markQueueCpuBlocked(rootDir, 5)
    await markQueueCpuBlocked(rootDir, 9)
    expect(await readQueueCpuBlockedSince(rootDir)).toBe(5)
  })

  it('an unparseable or invalid marker reads as absent and is replaced', async () => {
    const rootDir = root()
    const path = join(rootDir, QUEUE_CPU_MARKER_FILE)

    writeFileSync(path, '{not json')
    expect(await readQueueCpuBlockedSince(rootDir)).toBeNull()
    await markQueueCpuBlocked(rootDir, 7)
    expect(await readQueueCpuBlockedSince(rootDir)).toBe(7)

    writeFileSync(path, JSON.stringify({ since: 'x' }))
    expect(await readQueueCpuBlockedSince(rootDir)).toBeNull()
    await markQueueCpuBlocked(rootDir, 7)
    expect(await readQueueCpuBlockedSince(rootDir)).toBe(7)

    writeFileSync(path, JSON.stringify({ since: 0 }))
    expect(await readQueueCpuBlockedSince(rootDir)).toBeNull()
    await markQueueCpuBlocked(rootDir, 7)
    expect(await readQueueCpuBlockedSince(rootDir)).toBe(7)
  })

  it('clearQueueCpuBlock removes the marker and tolerates a missing one', async () => {
    const rootDir = root()
    await markQueueCpuBlocked(rootDir, 5)
    await clearQueueCpuBlock(rootDir)
    expect(await readQueueCpuBlockedSince(rootDir)).toBeNull()
    await expect(clearQueueCpuBlock(rootDir)).resolves.toBeUndefined()
  })

  it('readQueueCpuBlockedSince returns null for a missing root', async () => {
    const rootDir = join(root(), 'does-not-exist')
    await expect(readQueueCpuBlockedSince(rootDir)).resolves.toBeNull()
  })
})
