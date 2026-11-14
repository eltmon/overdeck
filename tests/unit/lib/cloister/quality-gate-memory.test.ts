import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, totalmem } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const configMocks = vi.hoisted(() => ({
  loadGlobalConfigNoMigration: vi.fn(),
}))

// D9: the soft reserve comes from the global-only loader.
vi.mock('../../../../src/lib/config-yaml/load.js', () => configMocks)

import { computeGovernorReserveDefaultsGb } from '../../../../src/lib/config-yaml/governor-reserves.js'
import {
  DEFAULT_GATE_FOOTPRINT_BYTES,
  evaluateMemoryHeadroom,
  footprintStoreDir,
  ownerReservationBytes,
  readGateFootprintEstimate,
  recordGateFootprintPeak,
  resolveSoftReserveBytes,
} from '../../../../src/lib/cloister/quality-gate-memory.js'

const GiB = 1024 ** 3

describe('gate footprint store (PAN-5248)', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-5248-footprint-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('returns the 2.5 GiB default for a key with no file', async () => {
    expect(DEFAULT_GATE_FOOTPRINT_BYTES).toBe(2.5 * GiB)
    await expect(readGateFootprintEstimate('tsc:tsconfig.json', root)).resolves.toBe(DEFAULT_GATE_FOOTPRINT_BYTES)
  })

  it('returns the max of the recorded peaks', async () => {
    await recordGateFootprintPeak('tsc:a.json', 1 * GiB, root)
    await recordGateFootprintPeak('tsc:a.json', 3 * GiB, root)
    await recordGateFootprintPeak('tsc:a.json', 2 * GiB, root)
    await expect(readGateFootprintEstimate('tsc:a.json', root)).resolves.toBe(3 * GiB)
    await expect(readGateFootprintEstimate('tsc:b.json', root)).resolves.toBe(DEFAULT_GATE_FOOTPRINT_BYTES)
  })

  it('keeps only the newest 5 peaks when a 6th is recorded', async () => {
    let at = 0
    for (const gib of [9, 1, 2, 3, 4, 5]) {
      await recordGateFootprintPeak('vitest:.', gib * GiB, root, () => ++at)
    }
    const files = readdirSync(footprintStoreDir(root))
    expect(files).toHaveLength(1)
    const stored = JSON.parse(readFileSync(join(footprintStoreDir(root), files[0]!), 'utf8'))
    expect(stored.key).toBe('vitest:.')
    expect(stored.peaks.map((peak: { bytes: number }) => peak.bytes / GiB)).toEqual([1, 2, 3, 4, 5])
    expect(stored.peaks.map((peak: { at: number }) => peak.at)).toEqual([2, 3, 4, 5, 6])
    await expect(readGateFootprintEstimate('vitest:.', root)).resolves.toBe(5 * GiB)
  })

  it('reads a torn file as the default', async () => {
    await recordGateFootprintPeak('tsc:a.json', 1 * GiB, root)
    const [file] = readdirSync(footprintStoreDir(root))
    writeFileSync(join(footprintStoreDir(root), file!), '{"key":"tsc:a.json","peaks":[{"by')
    await expect(readGateFootprintEstimate('tsc:a.json', root)).resolves.toBe(DEFAULT_GATE_FOOTPRINT_BYTES)
  })

  it('ignores non-finite and non-positive peaks', async () => {
    mkdirSync(footprintStoreDir(root), { recursive: true })
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await recordGateFootprintPeak('tsc:a.json', bad, root)
    }
    expect(readdirSync(footprintStoreDir(root))).toEqual([])
  })
})

describe('evaluateMemoryHeadroom (PAN-5248)', () => {
  const base = {
    memTotalBytes: 64 * GiB,
    softReserveBytes: 12 * GiB,
    estimateBytes: 2 * GiB,
    reservationsBytes: 3 * GiB,
  }

  it('is ok exactly when headroom equals the soft reserve', () => {
    const verdict = evaluateMemoryHeadroom({ ...base, memAvailableBytes: 17 * GiB })
    expect(verdict).toEqual({ ok: true, footprintBytes: 2 * GiB, headroomBytes: 12 * GiB })
  })

  it('is not ok one byte below the soft reserve', () => {
    const verdict = evaluateMemoryHeadroom({ ...base, memAvailableBytes: 17 * GiB - 1 })
    expect(verdict.ok).toBe(false)
    expect(verdict.headroomBytes).toBe(12 * GiB - 1)
  })

  it('clamps the footprint on a host smaller than the estimate', () => {
    const verdict = evaluateMemoryHeadroom({
      memAvailableBytes: 14 * GiB,
      memTotalBytes: 14 * GiB,
      softReserveBytes: 12 * GiB,
      estimateBytes: 2.5 * GiB,
      reservationsBytes: 0,
    })
    expect(verdict).toEqual({ ok: true, footprintBytes: 2 * GiB, headroomBytes: 12 * GiB })
  })

  it('clamps the footprint to 0 when the soft reserve exceeds total memory', () => {
    const verdict = evaluateMemoryHeadroom({ ...base, memTotalBytes: 8 * GiB, memAvailableBytes: 20 * GiB })
    expect(verdict.footprintBytes).toBe(0)
  })
})

describe('ownerReservationBytes (PAN-5248)', () => {
  const owner = { footprintBytes: 2.5 * GiB, rssBaselineBytes: 1 * GiB }

  it('subtracts growth above the baseline', () => {
    expect(ownerReservationBytes(owner, 1.1 * GiB)).toBeCloseTo(2.4 * GiB, 0)
  })

  it('floors at 0 once growth exceeds the footprint', () => {
    expect(ownerReservationBytes(owner, 5 * GiB)).toBe(0)
  })

  it('treats a tree below its baseline as no growth', () => {
    expect(ownerReservationBytes(owner, 0.5 * GiB)).toBe(2.5 * GiB)
  })

  it('reserves the whole footprint without a baseline, a tree read, or with fullReservation', () => {
    expect(ownerReservationBytes({ footprintBytes: 2.5 * GiB }, 1.1 * GiB)).toBe(2.5 * GiB)
    expect(ownerReservationBytes(owner, null)).toBe(2.5 * GiB)
    expect(ownerReservationBytes({ ...owner, fullReservation: true }, 1.1 * GiB)).toBe(2.5 * GiB)
  })

  it('reserves 0 for an old-version owner without a footprint', () => {
    expect(ownerReservationBytes({}, null)).toBe(0)
  })
})

describe('resolveSoftReserveBytes (PAN-5248)', () => {
  afterEach(() => {
    configMocks.loadGlobalConfigNoMigration.mockReset()
  })

  it('reads governorSoftReserveGb from the global config', async () => {
    configMocks.loadGlobalConfigNoMigration.mockResolvedValue({
      config: { resources: { governorSoftReserveGb: 12 } },
    })
    await expect(resolveSoftReserveBytes()).resolves.toBe(12 * GiB)
  })

  it('falls back to the RAM-share soft default when the loader throws', async () => {
    configMocks.loadGlobalConfigNoMigration.mockRejectedValue(new Error('config unreadable'))
    const expected = computeGovernorReserveDefaultsGb(totalmem() / GiB).soft * GiB
    await expect(resolveSoftReserveBytes()).resolves.toBe(expected)
  })
})
