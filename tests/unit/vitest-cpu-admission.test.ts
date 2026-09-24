import { afterEach, describe, expect, it, vi } from 'vitest'

import { QualityGateAdmissionTimeoutError } from '../../src/lib/cloister/quality-gate-admission.js'
import { setup, teardown } from '../vitest-cpu-admission.js'

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
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('proceeding without CPU admission'))
  })

  it('sets OVERDECK_GATE_ADMITTED after acquiring', async () => {
    const env: NodeJS.ProcessEnv = {}
    const acquire = vi.fn().mockResolvedValue({
      admittedAt: '2026-09-09T00:00:00.000Z',
      release: vi.fn(),
    })

    await setup({ env, acquire })

    expect(env.OVERDECK_GATE_ADMITTED).toBe('1')
    expect(acquire).toHaveBeenCalledWith(
      expect.objectContaining({ gateName: 'vitest', attempt: 1 }),
      expect.objectContaining({ maxWaitMs: 30 * 60_000 }),
    )
  })

  it('teardown releases the lease', async () => {
    const release = vi.fn()
    await setup({
      env: {},
      acquire: vi.fn().mockResolvedValue({ admittedAt: '2026-09-09T00:00:00.000Z', release }),
    })

    await teardown()

    expect(release).toHaveBeenCalledOnce()
  })
})
