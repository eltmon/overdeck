import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { QualityGateAdmissionTimeoutError } from '../../src/lib/cloister/quality-gate-admission.js'
import vitestGlobalSetup, { setup, teardown, vitestFootprintKey } from '../vitest-cpu-admission.js'

const GiB = 1024 ** 3
const noSampler = () => ({ stop: async () => null })

function admittedHandle(order: string[] = []) {
  return {
    admittedAt: '2026-09-09T00:00:00.000Z',
    slot: 0,
    slots: 2,
    footprintBytes: 2.5 * GiB,
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
      expect(vitestFootprintKey(join(top, 'a', 'b'))).toBe('vitest:a/b')
      expect(vitestFootprintKey(top)).toBe('vitest:.')
    } finally {
      rmSync(top, { recursive: true, force: true })
    }
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
