import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const configMocks = vi.hoisted(() => ({
  loadGlobalConfigNoMigration: vi.fn(),
}))

// D11: the starvation minutes come from the global-only loader.
vi.mock('../../../../src/lib/config-yaml/load.js', () => configMocks)

import {
  clearGateStarvationRecord,
  DEFAULT_QUALITY_GATE_STARVATION_MINUTES,
  evaluateGateStarvation,
  formatGateStarvationLine,
  GATE_STARVATION_FILE,
  gateAdmissionRoot,
  gateStarvationStatusLine,
  readGateStarvationRecord,
  resolveQualityGateStarvationMs,
  starvationEpisodeCloseReason,
  writeGateStarvationRecord,
  type GateStarvationRecord,
} from '../../../../src/lib/cloister/gate-starvation.js'

const GiB = 1024 ** 3
const roots: string[] = []

function home(): string {
  const path = mkdtempSync(join(tmpdir(), 'pan-5621-starvation-'))
  roots.push(path)
  return path
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

function head(extra: Record<string, unknown> = {}) {
  return {
    workspacePath: '/ws/pan-5489', gateName: 'tsc:tsconfig.json', createdAt: 0,
    ticketId: 't1', footprintKey: 'gate:typecheck:npm run typecheck', memoryBlockedSince: 0, ...extra,
  }
}

function owner(extra: Record<string, unknown> = {}) {
  return { workspacePath: '/ws/owner', gateName: 'vitest', createdAt: 0, acquiredAt: 0, ...extra }
}

const STARVATION_MS = 15 * 60_000

describe('evaluateGateStarvation (PAN-5621)', () => {
  const memory = { memAvailableBytes: 10.4e9, memTotalBytes: 62 * GiB }
  const base = { hardReserveBytes: 8 * GiB, headEstimateBytes: 2_864_852_992, starvationMs: STARVATION_MS }

  it('is starved for the incident inputs at exactly the threshold', () => {
    const verdict = evaluateGateStarvation({
      snapshot: { slots: 1, owners: [], waiters: [head({ memoryBlockedSince: 0 })] },
      memory, now: STARVATION_MS, ...base,
    })
    expect(verdict).toEqual({ starved: true, head: head(), memAvailableBytes: 10.4e9, footprintBytes: 2_864_852_992 })
  })

  it('is under-threshold 1 ms short of the bound', () => {
    const verdict = evaluateGateStarvation({
      snapshot: { slots: 1, owners: [], waiters: [head({ memoryBlockedSince: 0 })] },
      memory, now: STARVATION_MS - 1, ...base,
    })
    expect(verdict).toEqual({ starved: false, reason: 'under-threshold' })
  })

  it('is empty with no waiters', () => {
    const verdict = evaluateGateStarvation({ snapshot: { slots: 1, owners: [], waiters: [] }, memory, now: 1e9, ...base })
    expect(verdict).toEqual({ starved: false, reason: 'empty' })
  })

  it('is owner-running when a slot is held, even with a waiter queued', () => {
    const verdict = evaluateGateStarvation({
      snapshot: { slots: 1, owners: [owner()], waiters: [head()] }, memory, now: 1e9, ...base,
    })
    expect(verdict).toEqual({ starved: false, reason: 'owner-running' })
  })

  it.each([
    ['no footprintKey', head({ footprintKey: undefined })],
    ['no ticketId', head({ ticketId: undefined })],
    ['no memoryBlockedSince', head({ memoryBlockedSince: undefined })],
  ])('is head-not-memory-blocked for %s', (_label, waiter) => {
    const verdict = evaluateGateStarvation({
      snapshot: { slots: 1, owners: [], waiters: [waiter] }, memory, now: 1e9, ...base,
    })
    expect(verdict).toEqual({ starved: false, reason: 'head-not-memory-blocked' })
  })

  it('is head-not-memory-blocked when the caller passes a null estimate', () => {
    const verdict = evaluateGateStarvation({
      snapshot: { slots: 1, owners: [], waiters: [head()] }, memory, now: 1e9, ...base, headEstimateBytes: null,
    })
    expect(verdict).toEqual({ starved: false, reason: 'head-not-memory-blocked' })
  })

  it.each([null, { memAvailableBytes: 0, memTotalBytes: 62 * GiB }])('is memory-unreadable for %s', (badMemory) => {
    const verdict = evaluateGateStarvation({
      snapshot: { slots: 1, owners: [], waiters: [head()] }, memory: badMemory, now: 1e9, ...base,
    })
    expect(verdict).toEqual({ starved: false, reason: 'memory-unreadable' })
  })

  it('is fits-alone once MemAvailable leaves the hard reserve free', () => {
    const verdict = evaluateGateStarvation({
      snapshot: { slots: 1, owners: [], waiters: [head()] },
      memory: { memAvailableBytes: 20e9, memTotalBytes: 62 * GiB }, now: 1e9, ...base,
    })
    expect(verdict).toEqual({ starved: false, reason: 'fits-alone' })
  })
})

describe('starvationEpisodeCloseReason (PAN-5621)', () => {
  it('is null on readError, even with zero waiters', () => {
    expect(starvationEpisodeCloseReason({ slots: 1, owners: [], waiters: [], readError: 'ENOTDIR' }, 100)).toBeNull()
  })

  it('is admitted when an owner holds a slot', () => {
    expect(starvationEpisodeCloseReason({ slots: 1, owners: [owner()], waiters: [head()] }, 100)).toBe('admitted')
  })

  it('is admitted when lastAdmittedAt equals openedAtMs, and null 1 ms earlier with waiters present', () => {
    expect(starvationEpisodeCloseReason({ slots: 1, owners: [], waiters: [head()], lastAdmittedAt: 100 }, 100)).toBe('admitted')
    expect(starvationEpisodeCloseReason({ slots: 1, owners: [], waiters: [head()], lastAdmittedAt: 99 }, 100)).toBeNull()
  })

  it('is emptied for a confirmed empty queue', () => {
    expect(starvationEpisodeCloseReason({ slots: 1, owners: [], waiters: [] }, 100)).toBe('emptied')
  })
})

function baseRecord(extra: Partial<GateStarvationRecord> = {}): GateStarvationRecord {
  return {
    version: 1,
    since: new Date(0).toISOString(),
    openedAtMs: 0,
    announced: true,
    head: { ticketId: 't1', issueId: 'PAN-5489', gateName: 'tsc:tsconfig.json', workspacePath: '/ws/pan-5489', createdAt: 0 },
    memAvailableBytes: 9.4e9,
    hardReserveBytes: 8 * GiB,
    footprintBytes: 2_864_852_992,
    holders: [],
    ...extra,
  }
}

describe('gate starvation record round-trip (PAN-5621)', () => {
  it('round-trips announced, closing and a null footprint', async () => {
    const root = home()
    const record = baseRecord({ announced: false, closing: { at: new Date(1).toISOString(), reason: 'emptied' }, footprintBytes: null })
    await writeGateStarvationRecord(record, root)
    await expect(readGateStarvationRecord(root)).resolves.toEqual(record)
  })

  it('reads a torn file as null', async () => {
    const root = home()
    mkdirSync(gateAdmissionRoot(root), { recursive: true })
    writeFileSync(join(gateAdmissionRoot(root), GATE_STARVATION_FILE), '{not json')
    await expect(readGateStarvationRecord(root)).resolves.toBeNull()
  })

  it('reads a wrong-version record as null', async () => {
    const root = home()
    mkdirSync(gateAdmissionRoot(root), { recursive: true })
    writeFileSync(join(gateAdmissionRoot(root), GATE_STARVATION_FILE), JSON.stringify({ ...baseRecord(), version: 2 }))
    await expect(readGateStarvationRecord(root)).resolves.toBeNull()
  })

  it('clearing a missing record does not throw', async () => {
    const root = home()
    await expect(clearGateStarvationRecord(root)).resolves.toBeUndefined()
  })
})

describe('formatGateStarvationLine (PAN-5621)', () => {
  const holders = [
    { pid: 1234, rssBytes: 3.1 * GiB, comm: 'java', sessionName: null },
    { pid: 99, rssBytes: 2.2 * GiB, comm: 'node', sessionName: 'agent-pan-5611' },
    { pid: 7, rssBytes: 1.9 * GiB, comm: 'qemu', sessionName: null },
  ]

  it('names the gate, the issue, the needed memory and the holders captured at opening', () => {
    const line = formatGateStarvationLine(baseRecord({ holders }), { now: 52 * 60_000 })
    expect(line).toContain('tsc:tsconfig.json')
    expect(line).toContain('PAN-5489')
    expect(line).toContain('needs 2.7 GiB above the 8.0 GiB hard reserve')
    expect(line).toContain('Top memory at opening: java 3.1 GiB (pid 1234)')
    expect(line).toContain('node 2.2 GiB (pid 99, agent-pan-5611)')
  })

  it('omits Top memory when there are no holders', () => {
    expect(formatGateStarvationLine(baseRecord({ holders: [] }), { now: 1 })).not.toContain('Top memory')
  })

  it('omits " for <issue>" when the head has no issueId', () => {
    const line = formatGateStarvationLine(baseRecord({ head: { ...baseRecord().head, issueId: undefined } }), { now: 1 })
    expect(line).not.toContain(' for ')
  })

  it('omits "needs" when footprintBytes is null', () => {
    expect(formatGateStarvationLine(baseRecord({ footprintBytes: null }), { now: 1 })).not.toContain('needs')
  })

  it('uses the live MemAvailable when the reader passes one, else the record value', () => {
    expect(formatGateStarvationLine(baseRecord(), { now: 1, memAvailableBytes: 1 * GiB })).toContain('1.0 GiB available')
    expect(formatGateStarvationLine(baseRecord(), { now: 1 })).toContain('8.8 GiB available')
  })
})

describe('gateStarvationStatusLine (PAN-5621)', () => {
  it('is null with no record', async () => {
    const root = home()
    await expect(gateStarvationStatusLine({ rootDir: root })).resolves.toBeNull()
  })

  it('is null when the fresh queue has an owner', async () => {
    const root = home()
    await writeGateStarvationRecord(baseRecord(), root)
    const line = await gateStarvationStatusLine({
      rootDir: root,
      readQueue: async () => ({ slots: 1, owners: [owner()], waiters: [] }),
      readMemory: async () => null,
    })
    expect(line).toBeNull()
  })

  it('is null when lastAdmittedAt is at or after the episode opened', async () => {
    const root = home()
    await writeGateStarvationRecord(baseRecord({ openedAtMs: 100 }), root)
    const line = await gateStarvationStatusLine({
      rootDir: root,
      readQueue: async () => ({ slots: 1, owners: [], waiters: [head()], lastAdmittedAt: 100 }),
      readMemory: async () => null,
    })
    expect(line).toBeNull()
  })

  it('is null when the queue is confirmed empty', async () => {
    const root = home()
    await writeGateStarvationRecord(baseRecord(), root)
    const line = await gateStarvationStatusLine({
      rootDir: root,
      readQueue: async () => ({ slots: 1, owners: [], waiters: [] }),
      readMemory: async () => null,
    })
    expect(line).toBeNull()
  })

  it('is null when the fresh snapshot has a readError', async () => {
    const root = home()
    await writeGateStarvationRecord(baseRecord(), root)
    const line = await gateStarvationStatusLine({
      rootDir: root,
      readQueue: async () => ({ slots: 1, owners: [], waiters: [head()], readError: 'ENOTDIR' }),
      readMemory: async () => null,
    })
    expect(line).toBeNull()
  })

  it('is null when the record is closing', async () => {
    const root = home()
    await writeGateStarvationRecord(baseRecord({ closing: { at: new Date(1).toISOString(), reason: 'emptied' } }), root)
    const line = await gateStarvationStatusLine({
      rootDir: root,
      readQueue: async () => ({ slots: 1, owners: [], waiters: [head()] }),
      readMemory: async () => null,
    })
    expect(line).toBeNull()
  })

  it('is null when readQueue throws', async () => {
    const root = home()
    await writeGateStarvationRecord(baseRecord(), root)
    const line = await gateStarvationStatusLine({
      rootDir: root,
      readQueue: async () => { throw new Error('boom') },
      readMemory: async () => null,
    })
    expect(line).toBeNull()
  })

  it('returns the line for an open record with waiters, no owners and no newer admission', async () => {
    const root = home()
    await writeGateStarvationRecord(baseRecord(), root)
    const line = await gateStarvationStatusLine({
      rootDir: root,
      readQueue: async () => ({ slots: 1, owners: [], waiters: [head()] }),
      readMemory: async () => ({ memAvailableBytes: 9.4e9, memTotalBytes: 62 * GiB }),
    })
    expect(line).toContain('Gate queue starved since')
  })
})

describe('resolveQualityGateStarvationMs (PAN-5621)', () => {
  beforeEach(() => {
    configMocks.loadGlobalConfigNoMigration.mockReset()
  })

  it('reads the configured minutes from the global config', async () => {
    configMocks.loadGlobalConfigNoMigration.mockResolvedValue({ config: { resources: { qualityGateStarvationMinutes: 20 } } })
    await expect(resolveQualityGateStarvationMs()).resolves.toBe(20 * 60_000)
  })

  it('falls back to the 15-minute default when the loader rejects', async () => {
    configMocks.loadGlobalConfigNoMigration.mockRejectedValue(new Error('no config'))
    await expect(resolveQualityGateStarvationMs()).resolves.toBe(DEFAULT_QUALITY_GATE_STARVATION_MINUTES * 60_000)
  })

  it('falls back to the default for a non-positive value', async () => {
    configMocks.loadGlobalConfigNoMigration.mockResolvedValue({ config: { resources: { qualityGateStarvationMinutes: 0 } } })
    await expect(resolveQualityGateStarvationMs()).resolves.toBe(DEFAULT_QUALITY_GATE_STARVATION_MINUTES * 60_000)
  })
})
