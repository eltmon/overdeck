import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { QualityGateAdmissionTimeoutError } from '../../src/lib/cloister/quality-gate-admission.js'
import {
  DEFAULT_GATE_FOOTPRINT_BYTES,
  readGateFootprintEstimate,
  recordGateFootprintPeak,
} from '../../src/lib/cloister/quality-gate-memory.js'
import vitestGlobalSetup, { setup, teardown, vitestFootprintKey, vitestRunShape } from '../vitest-cpu-admission.js'

const GiB = 1024 ** 3
const noSampler = () => ({ stop: async () => null })

function admittedHandle(order: string[] = []) {
  return {
    admittedAt: '2026-09-09T00:00:00.000Z',
    slot: 0,
    slots: 2,
    footprintBytes: 2.5 * GiB,
    admittedAlone: false,
    recordPeak: vi.fn(async (bytes: number) => { order.push(`recordPeak:${bytes}`) }),
    release: vi.fn(async () => { order.push('release') }),
  }
}

afterEach(async () => {
  await teardown()
})

describe('Vitest CPU admission', () => {
  it('skips under OVERDECK_GATE_ADMITTED', async () => {
    const acquire = vi.fn()
    await setup({ env: { OVERDECK_GATE_ADMITTED: '1' }, acquire })
    expect(acquire).not.toHaveBeenCalled()
  })

  it('skips under CI', async () => {
    const acquire = vi.fn()
    await setup({ env: { CI: 'true' }, acquire })
    expect(acquire).not.toHaveBeenCalled()
  })

  it('skips under OVERDECK_GATE_ADMISSION=0', async () => {
    const acquire = vi.fn()
    await setup({ env: { OVERDECK_GATE_ADMISSION: '0' }, acquire })
    expect(acquire).not.toHaveBeenCalled()
  })

  it('fails open on timeout with a warning', async () => {
    const warn = vi.fn()
    const acquire = vi.fn().mockRejectedValue(new QualityGateAdmissionTimeoutError(30 * 60_000))

    await expect(setup({ env: {}, acquire, warn })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('proceeding without admission'))
  })

  it('fails open on a CPU timeout and fails closed on a memory timeout (PAN-5248)', async () => {
    const warn = vi.fn()
    const cpuTimeout = vi.fn().mockRejectedValue(new QualityGateAdmissionTimeoutError(30 * 60_000, 'cpu'))
    await expect(setup({ env: {}, acquire: cpuTimeout, warn })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('proceeding without admission'))

    const memoryTimeout = vi.fn().mockRejectedValue(new QualityGateAdmissionTimeoutError(30 * 60_000, 'memory', {
      kind: 'memory', memAvailableBytes: 13 * GiB, reservationsBytes: 0, footprintBytes: 2.5 * GiB, softReserveBytes: 12 * GiB,
    }))
    await expect(setup({ env: {}, acquire: memoryTimeout, warn })).rejects.toThrow(
      '[gate-admission] refusing to start vitest: waited 30 minutes for memory (available 13.0 GiB',
    )
  })

  it('requests a vitest footprint key (PAN-5248)', async () => {
    const acquire = vi.fn().mockResolvedValue(admittedHandle())
    await setup({ env: {}, acquire, startSampler: noSampler })
    expect(acquire.mock.calls[0]![0].footprintKey).toMatch(/^vitest:/)
  })

  it('teardown records the sampled peak before releasing (PAN-5248)', async () => {
    const order: string[] = []
    const handle = admittedHandle(order)
    const startSampler = vi.fn(() => ({ stop: async () => 1 * GiB }))
    await setup({ env: {}, acquire: vi.fn().mockResolvedValue(handle), startSampler })
    expect(startSampler).toHaveBeenCalledWith(process.pid)

    await teardown()
    expect(order).toEqual([`recordPeak:${1 * GiB}`, 'release'])
  })

  it('teardown skips recordPeak when the sampler saw nothing (PAN-5248)', async () => {
    const handle = admittedHandle()
    await setup({ env: {}, acquire: vi.fn().mockResolvedValue(handle), startSampler: noSampler })
    await teardown()
    expect(handle.recordPeak).not.toHaveBeenCalled()
    expect(handle.release).toHaveBeenCalledOnce()
  })

  it('the default export returns teardown so Vitest calls it (PAN-5248)', async () => {
    // Under this very run OVERDECK_GATE_ADMITTED=1 is set, so setup is a no-op here.
    const prior = process.env.OVERDECK_GATE_ADMITTED
    process.env.OVERDECK_GATE_ADMITTED = '1'
    try {
      await expect(vitestGlobalSetup()).resolves.toBe(teardown)
    } finally {
      if (prior === undefined) delete process.env.OVERDECK_GATE_ADMITTED
      else process.env.OVERDECK_GATE_ADMITTED = prior
    }
  })

  it('vitestFootprintKey is relative to the nearest .git ancestor (PAN-5248)', () => {
    const top = mkdtempSync(join(tmpdir(), 'pan-5248-vitest-key-'))
    try {
      mkdirSync(join(top, '.git'))
      mkdirSync(join(top, 'a', 'b'), { recursive: true })
      expect(vitestFootprintKey(join(top, 'a', 'b'))).toBe('vitest:a/b:suite')
      expect(vitestFootprintKey(top)).toBe('vitest:.:suite')
    } finally {
      rmSync(top, { recursive: true, force: true })
    }
  })

  it('keys a run by its shape: only a few existing files is a files run (PAN-5285)', () => {
    const top = mkdtempSync(join(tmpdir(), 'pan-5285-vitest-shape-'))
    try {
      mkdirSync(join(top, '.git'))
      mkdirSync(join(top, 'tests', 'unit'), { recursive: true })
      const names = Array.from({ length: 11 }, (_, i) => `tests/unit/t${i}.test.ts`)
      for (const name of names) writeFileSync(join(top, name), '')
      expect(vitestRunShape(top, undefined)).toBe('suite')
      expect(vitestRunShape(top, [])).toBe('suite')
      expect(vitestRunShape(top, ['tests/unit'])).toBe('suite')
      expect(vitestRunShape(top, names)).toBe('suite')
      expect(vitestRunShape(top, names.slice(0, 2))).toBe('files')
      expect(vitestFootprintKey(top, [names[0]!])).toBe('vitest:.:files')
    } finally {
      rmSync(top, { recursive: true, force: true })
    }
  })

  it('treats substring filters that may match many files as a suite (PAN-5285)', () => {
    const top = mkdtempSync(join(tmpdir(), 'pan-5285-vitest-substring-'))
    try {
      mkdirSync(join(top, '.git'))
      mkdirSync(join(top, 'tests'))
      writeFileSync(join(top, 'tests', 'a.test.ts'), '')
      // Vitest matches filters as path substrings: `.test.ts` selects every test file.
      expect(vitestRunShape(top, ['.test.ts'])).toBe('suite')
      expect(vitestRunShape(top, ['admission'])).toBe('suite')
      expect(vitestRunShape(top, ['tests/a.test.ts', 'admission'])).toBe('suite')
    } finally {
      rmSync(top, { recursive: true, force: true })
    }
  })

  it('a file-targeted run does not inherit a full-suite peak (PAN-5285)', async () => {
    const top = mkdtempSync(join(tmpdir(), 'pan-5285-vitest-peak-'))
    try {
      mkdirSync(join(top, '.git'))
      mkdirSync(join(top, 'tests', 'unit'), { recursive: true })
      writeFileSync(join(top, 'tests', 'unit', 'a.test.ts'), '')
      await recordGateFootprintPeak(vitestFootprintKey(top), 9.3 * GiB, top)
      await expect(readGateFootprintEstimate(vitestFootprintKey(top), top)).resolves.toBe(9.3 * GiB)
      await expect(readGateFootprintEstimate(vitestFootprintKey(top, ['tests/unit/a.test.ts']), top))
        .resolves.toBe(DEFAULT_GATE_FOOTPRINT_BYTES)
    } finally {
      rmSync(top, { recursive: true, force: true })
    }
  })

  it('passes its CLI filters into the key and prints every wait reason (PAN-5285)', async () => {
    const warn = vi.fn()
    const acquire = vi.fn(async (_request: unknown, acquireDeps?: { onWaiting?: (reason: unknown) => void }) => {
      acquireDeps?.onWaiting?.({ kind: 'queue', position: 2, blocker: { gateName: 'typecheck', issueId: 'PAN-9', workspacePath: '/w' } })
      return { ...admittedHandle(), admittedAlone: true, footprintBytes: 9 * GiB }
    })
    await setup({ env: {}, acquire: acquire as never, warn, startSampler: noSampler, filters: ['tests/unit/vitest-cpu-admission.test.ts'] })

    const key = (acquire.mock.calls[0]![0] as { footprintKey: string }).footprintKey
    expect(key).toMatch(/:files$/)
    expect(warn).toHaveBeenCalledWith(`[gate-admission] ${key} waiting in the admission queue at position 3 behind typecheck (PAN-9) in /w`)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`[gate-admission] ${key} admitted alone after waiting past the bypass bound: needs 9.0 GiB`))
  })

  it('sets OVERDECK_GATE_ADMITTED after acquiring', async () => {
    const env: NodeJS.ProcessEnv = {}
    const acquire = vi.fn().mockResolvedValue(admittedHandle())

    await setup({ env, acquire, startSampler: noSampler })

    expect(env.OVERDECK_GATE_ADMITTED).toBe('1')
    expect(acquire).toHaveBeenCalledWith(
      expect.objectContaining({ gateName: 'vitest', attempt: 1 }),
      expect.objectContaining({ maxWaitMs: 30 * 60_000 }),
    )
  })

  it('teardown releases the lease', async () => {
    const handle = admittedHandle()
    await setup({ env: {}, acquire: vi.fn().mockResolvedValue(handle), startSampler: noSampler })

    await teardown()

    expect(handle.release).toHaveBeenCalledOnce()
  })
})
