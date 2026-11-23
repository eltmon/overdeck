import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import {
  CHAIN_MAX_WAIT_MS,
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
    admittedAlone: false,
    cpuBypassed: false,
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
    expect(deps.spawn).toHaveBeenCalledWith(input.command, input.args, expect.objectContaining({
      env: expect.objectContaining({ OVERDECK_GATE_ADMISSION: '0' }),
    }))
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

  it('names the gate ahead in a queue wait and announces an alone admission (PAN-5285)', async () => {
    const { deps, warn } = setup({
      acquire: vi.fn(async (_request, acquireDeps) => {
        acquireDeps?.onWaiting?.({ kind: 'queue', position: 0, blocker: { gateName: 'vitest', workspacePath: '/w' }, headAlone: true })
        return { ...fakeHandle(), admittedAlone: true, footprintBytes: 9 * GiB }
      }),
    })
    await runAdmittedCommand(input, deps)
    const lines = warn.mock.calls.map(([line]) => String(line))
    expect(lines[0]).toBe('[gate-admission] tsc:tsconfig.json waiting in the admission queue at position 1: '
      + 'vitest in /w has waited past the bypass bound and runs alone next')
    expect(lines[1]).toContain('[gate-admission] tsc:tsconfig.json admitted alone after waiting past the bypass bound: needs 9.0 GiB')
  })

  it('announces an admission past the CPU bypass bound (PAN-5520)', async () => {
    const { deps, warn } = setup({ acquire: vi.fn(async () => ({ ...fakeHandle(), cpuBypassed: true })) })
    await runAdmittedCommand(input, deps)
    const lines = warn.mock.calls.map(([line]) => String(line))
    expect(lines).toContain('[gate-admission] tsc:tsconfig.json admitted alone: '
      + 'the admission queue has been blocked on CPU past the bypass bound, '
      + 'so it starts without waiting for CPU pressure to clear and may run slowly')
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

describe('admitted chains (PAN-5617)', () => {
  it('a chain of 12 lanes enters the admission queue once', async () => {
    const acquire = vi.fn(async () => fakeHandle())
    const innerSpawn = fakeSpawn(0)
    const chainSpawn = vi.fn((_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const child = Object.assign(new EventEmitter(), { pid: 1111, kill: vi.fn() })
      void (async () => {
        for (let lane = 0; lane < 12; lane++) {
          await runAdmittedCommand(
            { footprintKey: `tsc:lane-${lane}`, command: 'tsc', args: ['--noEmit'], cwd: '/repo' },
            { env: options.env, acquire, spawn: innerSpawn as unknown as RunAdmittedDeps['spawn'], warn: vi.fn() },
          )
        }
        child.emit('exit', 0, null)
      })()
      return child
    })
    const result = await runAdmittedCommand(
      { footprintKey: 'chain:typecheck', command: 'npm', args: ['run', 'typecheck:lanes'], cwd: '/repo' },
      { env: {}, acquire, spawn: chainSpawn as unknown as RunAdmittedDeps['spawn'], startSampler: vi.fn(() => ({ stop: vi.fn(async () => null) })), warn: vi.fn() },
    )
    expect(result).toBe(0)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire).toHaveBeenCalledWith(
      expect.objectContaining({ footprintKey: 'chain:typecheck' }),
      expect.anything(),
    )
    expect(innerSpawn).toHaveBeenCalledTimes(12)
    for (const call of innerSpawn.mock.calls) {
      expect((call[2] as { env: NodeJS.ProcessEnv }).env.OVERDECK_GATE_ADMITTED).toBe('1')
    }
  })

  it('a lone lane enters the admission queue once', async () => {
    const { deps } = setup()
    await runAdmittedCommand(input, deps)
    expect(deps.acquire).toHaveBeenCalledTimes(1)
    expect(deps.acquire).toHaveBeenCalledWith(
      expect.objectContaining({ footprintKey: 'tsc:tsconfig.json' }),
      expect.anything(),
    )
  })

  it('after an admission setup failure the chain runs with OVERDECK_GATE_ADMISSION=0 and its lanes do not queue', async () => {
    const acquire = vi.fn(async () => { throw new Error('EACCES: admission root') })
    const innerSpawn = fakeSpawn(0)
    const chainSpawn = vi.fn((_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const child = Object.assign(new EventEmitter(), { pid: 2222, kill: vi.fn() })
      void (async () => {
        for (let lane = 0; lane < 2; lane++) {
          await runAdmittedCommand(
            { footprintKey: `tsc:lane-${lane}`, command: 'tsc', args: ['--noEmit'], cwd: '/repo' },
            { env: options.env, acquire, spawn: innerSpawn as unknown as RunAdmittedDeps['spawn'], warn: vi.fn() },
          )
        }
        child.emit('exit', 0, null)
      })()
      return child
    })
    const result = await runAdmittedCommand(
      { footprintKey: 'chain:typecheck', command: 'npm', args: ['run', 'typecheck:lanes'], cwd: '/repo' },
      { env: {}, acquire, failClosedOnTimeout: true, spawn: chainSpawn as unknown as RunAdmittedDeps['spawn'], warn: vi.fn() },
    )
    expect(result).toBe(0)
    expect(chainSpawn).toHaveBeenCalledWith('npm', ['run', 'typecheck:lanes'], expect.objectContaining({
      env: expect.objectContaining({ OVERDECK_GATE_ADMISSION: '0' }),
    }))
    const chainSpawnEnv = (chainSpawn.mock.calls[0]![2] as { env: NodeJS.ProcessEnv }).env
    expect(chainSpawnEnv.OVERDECK_GATE_ADMITTED).toBeUndefined()
    expect(innerSpawn).toHaveBeenCalledTimes(2)
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it('passes maxWaitMs through to acquire and names it in the memory refusal', async () => {
    const memory = { kind: 'memory' as const, memAvailableBytes: 13 * GiB, reservationsBytes: 2.4 * GiB, footprintBytes: 2.5 * GiB, softReserveBytes: 12 * GiB }
    const { deps, warn } = setup({
      maxWaitMs: CHAIN_MAX_WAIT_MS,
      acquire: vi.fn(async () => { throw new QualityGateAdmissionTimeoutError(CHAIN_MAX_WAIT_MS, 'memory', memory) }),
    })
    await expect(runAdmittedCommand(input, deps)).resolves.toBe(75)
    expect(deps.acquire).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxWaitMs: CHAIN_MAX_WAIT_MS }),
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('waited 60 minutes for memory'))
  })

  it.each(['queue', 'slots', 'cpu'] as const)('a chain refuses to start after a %s timeout', async (kind) => {
    const { deps, warn } = setup({
      failClosedOnTimeout: true,
      maxWaitMs: CHAIN_MAX_WAIT_MS,
      acquire: vi.fn(async () => { throw new QualityGateAdmissionTimeoutError(CHAIN_MAX_WAIT_MS, kind) }),
    })
    await expect(runAdmittedCommand(input, deps)).resolves.toBe(75)
    expect(deps.spawn).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      `[gate-admission] refusing to start tsc:tsconfig.json: waited 60 minutes for admission (last waiting on ${kind})`,
    )
  })

  it('a lone lane still proceeds after a queue timeout', async () => {
    const { deps } = setup({
      acquire: vi.fn(async () => { throw new QualityGateAdmissionTimeoutError(1_000, 'queue') }),
    })
    await expect(runAdmittedCommand(input, deps)).resolves.toBe(0)
    expect(deps.spawn).toHaveBeenCalledTimes(1)
  })
})
