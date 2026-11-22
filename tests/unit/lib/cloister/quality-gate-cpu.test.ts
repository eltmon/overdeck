import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  clearQueueCpuBlock,
  isQualityGateCpuPressured,
  markQueueCpuBlocked,
  QUALITY_GATE_CONTENDED_UTILIZATION_FLOOR,
  QUALITY_GATE_CPU_START_THRESHOLD,
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

describe('isQualityGateCpuPressured (PAN-5589)', () => {
  const psiStartAvg10 = 25

  it.each([
    [0.49, 99, 0, false],
    [0.5, 25, 0, true],
    [0.5, 24.9, 0, false],
    [0.74, 0, 0, false],
    [0.75, 0, 0, true],
    [0.49, null, 5, false],
    [0.5, null, 1, true],
    [0.5, null, 0.99, false],
  ])('cpuUtilization %s, psiSomeAvg10 %s, loadPerCore %s -> pressured %s', (cpuUtilization, psiSomeAvg10, loadPerCore, expected) => {
    expect(isQualityGateCpuPressured({ cpuUtilization, loadPerCore, psiSomeAvg10 }, psiStartAvg10)).toBe(expected)
  })

  it('exposes the contended-utilization floor and the CPU start threshold', () => {
    expect(QUALITY_GATE_CONTENDED_UTILIZATION_FLOOR).toBe(0.5)
    expect(QUALITY_GATE_CPU_START_THRESHOLD).toBe(0.75)
  })
})
