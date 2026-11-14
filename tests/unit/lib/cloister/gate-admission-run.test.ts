import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import {
  runAdmittedCommand,
  shouldBypassAdmission,
  tscFootprintKey,
  type RunAdmittedDeps,
} from '../../../../src/lib/cloister/gate-admission-run.js'
import {
  QualityGateAdmissionTimeoutError,
  type QualityGateAdmissionHandle,
} from '../../../../src/lib/cloister/quality-gate-admission.js'

const GiB = 1024 ** 3
const input = { footprintKey: 'tsc:tsconfig.json', command: '/repo/node_modules/.bin/tsc', args: ['--noEmit'], cwd: '/repo' }

/** A spawn whose child exits with `code`/`signal` right after its listeners attach. */
function fakeSpawn(code: number | null, signal: NodeJS.Signals | null = null) {
  return vi.fn((..._args: unknown[]) => {
    const child = Object.assign(new EventEmitter(), { pid: 4321, kill: vi.fn() })
    queueMicrotask(() => child.emit('exit', code, signal))
    return child
  })
}

function fakeHandle(order: string[] = []): QualityGateAdmissionHandle {
  return {
    admittedAt: '2026-11-14T00:00:00.000Z',
    slot: 0,
    slots: 2,
    footprintBytes: 2.5 * GiB,
    recordPeak: vi.fn(async (bytes: number) => { order.push(`recordPeak:${bytes}`) }),
    release: vi.fn(async () => { order.push('release') }),
  }
}

function setup(overrides: Partial<RunAdmittedDeps> & { peak?: number | null } = {}) {
  const order: string[] = []
  const handle = fakeHandle(order)
  const warn = vi.fn()
  const sampler = { stop: vi.fn(async () => overrides.peak === undefined ? 2 * GiB : overrides.peak) }
  const deps: RunAdmittedDeps = {
    env: {},
    acquire: vi.fn(async () => handle),
    spawn: fakeSpawn(0) as unknown as RunAdmittedDeps['spawn'],
    startSampler: vi.fn(() => sampler),
    warn,
    ...overrides,
  }
  return { deps, handle, warn, sampler, order }
}

describe('tscFootprintKey (PAN-5248)', () => {
  it('names the project tsconfig without a leading ./', () => {
    expect(tscFootprintKey(['--noEmit', '-p', './src/x/tsconfig.json'])).toBe('tsc:src/x/tsconfig.json')
    expect(tscFootprintKey(['--noEmit', '--project', 'packages/a/tsconfig.json'])).toBe('tsc:packages/a/tsconfig.json')
    expect(tscFootprintKey(['--project=tsconfig.effect-diag.json'])).toBe('tsc:tsconfig.effect-diag.json')
  })

  it('defaults to tsconfig.json without -p', () => {
    expect(tscFootprintKey(['--noEmit'])).toBe('tsc:tsconfig.json')
  })
})

describe('runAdmittedCommand (PAN-5248)', () => {
  it.each([
    [{ CI: 'true' }],
    [{ OVERDECK_GATE_ADMISSION: '0' }],
    [{ OVERDECK_GATE_ADMITTED: '1' }],
  ])('bypasses admission under %o', async (env) => {
    expect(shouldBypassAdmission(env)).toBe(true)
    const { deps } = setup({ env })
    await expect(runAdmittedCommand(input, deps)).resolves.toBe(0)
    expect(deps.acquire).not.toHaveBeenCalled()
    expect(deps.startSampler).not.toHaveBeenCalled()
    expect(deps.spawn).toHaveBeenCalledTimes(1)
  })

  it('passes the exit code through, records the peak and then releases', async () => {
    const { deps, handle, order } = setup({ spawn: fakeSpawn(2) as unknown as RunAdmittedDeps['spawn'] })
    await expect(runAdmittedCommand(input, deps)).resolves.toBe(2)
    expect(deps.acquire).toHaveBeenCalledWith(
      expect.objectContaining({ footprintKey: 'tsc:tsconfig.json', gateName: 'tsc:tsconfig.json', workspacePath: '/repo' }),
      expect.objectContaining({ maxWaitMs: 30 * 60_000 }),
    )
    expect(deps.startSampler).toHaveBeenCalledWith(4321)
    expect(handle.recordPeak).toHaveBeenCalledWith(2 * GiB)
    expect(order).toEqual([`recordPeak:${2 * GiB}`, 'release'])
  })

  it('runs the admitted child with OVERDECK_GATE_ADMITTED=1 and inherited stdio', async () => {
    const { deps } = setup({ env: { PATH: '/bin' } })
    await runAdmittedCommand(input, deps)
    expect(deps.spawn).toHaveBeenCalledWith(input.command, input.args, expect.objectContaining({
      cwd: '/repo',
      stdio: 'inherit',
      env: { PATH: '/bin', OVERDECK_GATE_ADMITTED: '1' },
    }))
  })

  it('returns 128 + signal for a signal exit and records nothing', async () => {
    const { deps, handle } = setup({ spawn: fakeSpawn(null, 'SIGINT') as unknown as RunAdmittedDeps['spawn'] })
    await expect(runAdmittedCommand(input, deps)).resolves.toBe(130)
    expect(handle.recordPeak).not.toHaveBeenCalled()
    expect(handle.release).toHaveBeenCalledTimes(1)
  })

  it('skips recordPeak when the sampler saw nothing', async () => {
    const { deps, handle } = setup({ peak: null })
    await expect(runAdmittedCommand(input, deps)).resolves.toBe(0)
    expect(handle.recordPeak).not.toHaveBeenCalled()
    expect(handle.release).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a CPU timeout', new QualityGateAdmissionTimeoutError(1_000, 'cpu')],
    ['a generic error', new Error('EACCES: admission root')],
  ])('proceeds without admission after %s', async (_label, error) => {
    const { deps, warn } = setup({ acquire: vi.fn(async () => { throw error }) })
    await expect(runAdmittedCommand(input, deps)).resolves.toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[gate-admission] proceeding without admission:'))
    expect(deps.spawn).toHaveBeenCalledTimes(1)
    expect(deps.startSampler).not.toHaveBeenCalled()
  })

  it('refuses to start after a memory timeout and never spawns', async () => {
    const memory = { kind: 'memory' as const, memAvailableBytes: 13 * GiB, reservationsBytes: 2.4 * GiB, footprintBytes: 2.5 * GiB, softReserveBytes: 12 * GiB }
    const { deps, warn } = setup({
      acquire: vi.fn(async () => { throw new QualityGateAdmissionTimeoutError(30 * 60_000, 'memory', memory) }),
    })
    await expect(runAdmittedCommand(input, deps)).resolves.toBe(75)
    expect(deps.spawn).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[gate-admission] refusing to start tsc:tsconfig.json: waited 30 minutes for memory '
      + '(available 13.0 GiB, reserved 2.4 GiB, needs 2.5 GiB, soft reserve 12.0 GiB)',
    )
  })

  it('prints wait reasons on stderr without tsc diagnostic text', async () => {
    const { deps, warn } = setup({
      acquire: vi.fn(async (_request, acquireDeps) => {
        acquireDeps?.onWaiting?.({ kind: 'memory', memAvailableBytes: 13 * GiB, reservationsBytes: 0, footprintBytes: 2.5 * GiB, softReserveBytes: 12 * GiB })
        acquireDeps?.onWaiting?.({ kind: 'queue' })
        return fakeHandle()
      }),
    })
    await runAdmittedCommand(input, deps)
    const lines = warn.mock.calls.map(([line]) => String(line))
    expect(lines[0]).toBe('[gate-admission] tsc:tsconfig.json waiting for memory: available 13.0 GiB, reserved 0.0 GiB, needs 2.5 GiB, soft reserve 12.0 GiB')
    expect(lines.every((line) => line.startsWith('[gate-admission]') && !/error TS/.test(line))).toBe(true)
  })

  it('releases and resolves 1 when the command cannot start', async () => {
    const spawn = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { pid: undefined, kill: vi.fn() })
      queueMicrotask(() => child.emit('error', new Error('spawn tsc ENOENT')))
      return child
    })
    const { deps, handle, warn } = setup({ spawn: spawn as unknown as RunAdmittedDeps['spawn'] })
    await expect(runAdmittedCommand(input, deps)).resolves.toBe(1)
    expect(handle.release).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not start'))
  })
})
