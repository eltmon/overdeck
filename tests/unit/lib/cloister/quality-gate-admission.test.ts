import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as realSetImmediate } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const osMocks = vi.hoisted(() => ({
  cpus: vi.fn(),
  loadavg: vi.fn(),
}))

// PAN-4311: pin CPU counters and load so the pressure sample is deterministic.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  osMocks.cpus.mockImplementation(actual.cpus)
  osMocks.loadavg.mockImplementation(actual.loadavg)
  return { ...actual, cpus: () => osMocks.cpus(), loadavg: () => osMocks.loadavg() }
})

const configMocks = vi.hoisted(() => ({
  loadGlobalConfigNoMigration: vi.fn(),
  loadConfigNoMigration: vi.fn(),
}))

// PAN-4546 D5: the slot count comes from the global-only loader, never the project-merged one.
vi.mock('../../../../src/lib/config-yaml/load.js', () => configMocks)

import {
  acquireQualityGateAdmission,
  QualityGateAdmissionTimeoutError,
  readQualityGateAdmissionOwnerPids,
  sampleQualityGatePressure,
  type QualityGateAdmissionDeps,
  type QualityGatePressureSample,
} from '../../../../src/lib/cloister/quality-gate-admission.js'
import { recordGateFootprintPeak } from '../../../../src/lib/cloister/quality-gate-memory.js'

const homes: string[] = []
const low: QualityGatePressureSample = { cpuUtilization: 0.2, loadPerCore: 0.2, psiSomeAvg10: null, pressured: false }
const high: QualityGatePressureSample = { cpuUtilization: 0.95, loadPerCore: 1.5, psiSomeAvg10: null, pressured: true }

function home(): string {
  const path = mkdtempSync(join(tmpdir(), 'quality-gate-admission-'))
  homes.push(path)
  return path
}

function deps(rootDir: string, samples: QualityGatePressureSample[] = [low]): QualityGateAdmissionDeps {
  let sampleIndex = 0
  return {
    rootDir,
    pollMs: 100,
    settleMs: 200,
    staleMs: 1_000,
    tornGraceMs: 10_000,
    slots: 1,
    isProcessAlive: (pid) => pid === process.pid,
    samplePressure: vi.fn(async () => samples[Math.min(sampleIndex++, samples.length - 1)]!),
    // PAN-5248: memory-agnostic unless a case opts in.
    sampleMemory: async () => null,
  }
}

// Captured before vi.useFakeTimers() so it always schedules real wall-clock time.
const nativeSetTimeout = globalThis.setTimeout

async function drive(attempts: number, done: () => boolean = () => false): Promise<void> {
  for (let attempt = 0; attempt < attempts && !done(); attempt++) {
    // The admission loop awaits real fs promises that resolve on the libuv
    // threadpool; on a loaded host a bare setImmediate spin exhausts every
    // attempt before a single fs op completes. A 1ms real yield per attempt
    // gives the threadpool wall-clock time without unfaking tested delays.
    await new Promise((resolve) => nativeSetTimeout(resolve, 1))
    await realSetImmediate()
    await vi.runOnlyPendingTimersAsync()
  }
}

async function driveUntil(done: () => boolean): Promise<void> {
  await drive(100, done)
  expect(done()).toBe(true)
}

/** A slot owner file body for `pid`, acquired at `acquiredAt`. */
function ownerJson(pid: number, acquiredAt: number): string {
  return JSON.stringify({
    ticketId: `owner-${pid}`,
    pid,
    createdAt: acquiredAt,
    acquiredAt,
    workspacePath: '/tmp/owner',
    gateName: 'test',
    attempt: 1,
  })
}

async function driveUntilResolved<T>(promise: Promise<T>): Promise<T> {
  let settled = false
  promise.finally(() => { settled = true }).catch(() => undefined)
  await driveUntil(() => settled)
  return promise
}

/** Waiter files whose parsed ticket was created at `createdAt`. */
function ticketFilesCreatedAt(rootDir: string, createdAt: number): string[] {
  return readdirSync(rootDir)
    .filter((entry) => entry.startsWith('waiter-') && entry.endsWith('.json'))
    .filter((entry) => {
      try {
        return JSON.parse(readFileSync(join(rootDir, entry), 'utf8')).createdAt === createdAt
      } catch {
        return false
      }
    })
}

beforeEach(() => {
  vi.useFakeTimers({ doNotFake: ['setImmediate'] })
})

afterEach(() => {
  vi.useRealTimers()
  for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('quality gate admission', () => {
  it('admits waiters in FIFO order and holds the next waiter until release', async () => {
    const rootDir = home()
    const firstPromise = acquireQualityGateAdmission(
      { issueId: 'PAN-1', workspacePath: '/tmp/one', gateName: 'test', attempt: 1 },
      { ...deps(rootDir), now: () => 1 },
    )
    const secondPromise = acquireQualityGateAdmission(
      { issueId: 'PAN-2', workspacePath: '/tmp/two', gateName: 'test', attempt: 1 },
      { ...deps(rootDir), now: () => 2 },
    )
    let secondResolved = false
    void secondPromise.then(() => { secondResolved = true })

    const first = await driveUntilResolved(firstPromise)
    expect(secondResolved).toBe(false)

    await first.release()
    const second = await driveUntilResolved(secondPromise)
    expect(second.admittedAt).toBe(new Date(2).toISOString())
    await second.release()
  })

  it('waits for CPU pressure to recover before admission', async () => {
    const rootDir = home()
    const samplePressure = vi.fn()
      .mockResolvedValueOnce(high)
      .mockResolvedValue(low)
    const admission = acquireQualityGateAdmission(
      { workspacePath: '/tmp/one', gateName: 'lint', attempt: 1 },
      { ...deps(rootDir), samplePressure },
    )
    const handle = await driveUntilResolved(admission)
    expect(samplePressure).toHaveBeenCalledTimes(3)
    await handle.release()
  })

  it('rechecks pressure after the settle period before returning a lease', async () => {
    const rootDir = home()
    const samplePressure = vi.fn()
      .mockResolvedValueOnce(low)
      .mockResolvedValueOnce(high)
      .mockResolvedValue(low)
    const admission = acquireQualityGateAdmission(
      { workspacePath: '/tmp/one', gateName: 'typecheck', attempt: 1 },
      { ...deps(rootDir), samplePressure },
    )
    const handle = await driveUntilResolved(admission)
    expect(samplePressure).toHaveBeenCalledTimes(4)
    await handle.release()
  })

  it('reclaims a stale owner before admitting the oldest live waiter', async () => {
    const rootDir = home()
    writeFileSync(join(rootDir, 'owner.break'), JSON.stringify({ pid: 999_998, acquiredAt: 0 }))
    writeFileSync(join(rootDir, 'owner.json'), JSON.stringify({
      ticketId: 'dead-owner',
      pid: 999_999,
      createdAt: 0,
      acquiredAt: 0,
      workspacePath: '/tmp/dead',
      gateName: 'test',
      attempt: 1,
    }))

    const admission = acquireQualityGateAdmission(
      { workspacePath: '/tmp/one', gateName: 'test', attempt: 1 },
      { ...deps(rootDir), now: () => 10_000 },
    )
    const handle = await driveUntilResolved(admission)
    await handle.release()
  })

  it('maxWaitMs expiry removes the waiter ticket and throws', async () => {
    const rootDir = home()
    const now = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValue(101)

    await expect(acquireQualityGateAdmission(
      { workspacePath: '/tmp/one', gateName: 'test', attempt: 1 },
      { ...deps(rootDir), now, maxWaitMs: 100 },
    )).rejects.toBeInstanceOf(QualityGateAdmissionTimeoutError)

    expect(readdirSync(rootDir).filter((entry) => entry.startsWith('waiter-'))).toEqual([])
  })

  describe('N slots (PAN-4546)', () => {
    const request = { workspacePath: '/tmp/one', gateName: 'test', attempt: 1 }

    it('admits two concurrent requests with two slots', async () => {
      const rootDir = home()
      const firstPromise = acquireQualityGateAdmission(request, { ...deps(rootDir), slots: 2, now: () => 1 })
      const secondPromise = acquireQualityGateAdmission(request, { ...deps(rootDir), slots: 2, now: () => 2 })

      const first = await driveUntilResolved(firstPromise)
      const second = await driveUntilResolved(secondPromise)

      expect(first).toMatchObject({ slot: 0, slots: 2 })
      expect(second).toMatchObject({ slot: 1, slots: 2 })
      expect(readdirSync(rootDir)).toEqual(expect.arrayContaining(['owner.json', 'slot-1.json']))
      await first.release()
      await second.release()
    })

    it('keeps a pressured second request waiting until slot 0 frees and pressure clears', async () => {
      const rootDir = home()
      const first = await driveUntilResolved(acquireQualityGateAdmission(
        request,
        { ...deps(rootDir, [low, low]), slots: 2, now: () => 1 },
      ))
      const samplePressure = vi.fn().mockResolvedValue(high)
      const secondPromise = acquireQualityGateAdmission(request, { ...deps(rootDir), slots: 2, now: () => 2, samplePressure })
      let secondResolved = false
      void secondPromise.then(() => { secondResolved = true })

      await drive(20)
      expect(secondResolved).toBe(false)
      expect(existsSync(join(rootDir, 'slot-1.json'))).toBe(false)

      await first.release()
      // Let B finish any pass that listed slot 0 as held before it sees low pressure.
      await drive(5)
      samplePressure.mockResolvedValue(low)
      const second = await driveUntilResolved(secondPromise)
      expect(second.slot).toBe(0)
      await second.release()
    })

    it('reclaims a dead owner in slot 1 and leaves the live slot 0 owner alone', async () => {
      const rootDir = home()
      const liveOwner = ownerJson(process.pid, 10_000)
      writeFileSync(join(rootDir, 'owner.json'), liveOwner)
      writeFileSync(join(rootDir, 'slot-1.json'), ownerJson(999_999, 10_000))

      const handle = await driveUntilResolved(acquireQualityGateAdmission(
        request,
        { ...deps(rootDir), slots: 2, now: () => 10_000 },
      ))

      expect(handle.slot).toBe(1)
      expect(readFileSync(join(rootDir, 'owner.json'), 'utf8')).toBe(liveOwner)
      await handle.release()
    })

    it('clears a torn slot file older than the torn grace', async () => {
      const rootDir = home()
      const tornPath = join(rootDir, 'slot-1.json')
      writeFileSync(tornPath, '{')
      const sixtySecondsAgo = new Date(Date.now() - 60_000)
      utimesSync(tornPath, sixtySecondsAgo, sixtySecondsAgo)

      const handle = await driveUntilResolved(acquireQualityGateAdmission(request, { ...deps(rootDir), slots: 2 }))

      expect(handle.slot).toBe(0)
      expect(existsSync(tornPath)).toBe(false)
      await handle.release()
    })

    it('treats a fresh torn slot file as occupied', async () => {
      const rootDir = home()
      const tornPath = join(rootDir, 'slot-1.json')
      writeFileSync(tornPath, '{')

      const handle = await driveUntilResolved(acquireQualityGateAdmission(request, { ...deps(rootDir), slots: 2 }))

      expect(handle.slot).toBe(0)
      expect(readFileSync(tornPath, 'utf8')).toBe('{')
      await handle.release()
    })

    it('counts a held slot above a lowered slot count against capacity', async () => {
      const rootDir = home()
      writeFileSync(join(rootDir, 'slot-1.json'), ownerJson(process.pid, 10_000))
      const admission = acquireQualityGateAdmission(request, { ...deps(rootDir), now: () => 10_000 })
      let resolved = false
      void admission.then(() => { resolved = true })

      await drive(20)
      expect(resolved).toBe(false)

      unlinkSync(join(rootDir, 'slot-1.json'))
      const handle = await driveUntilResolved(admission)
      expect(handle.slot).toBe(0)
      await handle.release()
    })

    it('ignores non-canonical slot file names', async () => {
      const rootDir = home()
      const aliasBody = { 'slot-0.json': ownerJson(4_242, 10_000), 'slot-01.json': ownerJson(4_343, 10_000) }
      for (const [name, body] of Object.entries(aliasBody)) writeFileSync(join(rootDir, name), body)

      const handle = await driveUntilResolved(acquireQualityGateAdmission(request, {
        ...deps(rootDir),
        now: () => 10_000,
        isProcessAlive: (pid) => pid === process.pid || pid === 4_242 || pid === 4_343,
      }))

      expect(handle.slot).toBe(0)
      expect(await readQualityGateAdmissionOwnerPids(rootDir)).toEqual([process.pid])
      await handle.release()
      for (const [name, body] of Object.entries(aliasBody)) {
        expect(readFileSync(join(rootDir, name), 'utf8')).toBe(body)
      }
      expect(await readQualityGateAdmissionOwnerPids(rootDir)).toEqual([])
    })

    it('reads the pid of every canonical slot owner', async () => {
      const rootDir = home()
      writeFileSync(join(rootDir, 'owner.json'), ownerJson(111, 1))
      writeFileSync(join(rootDir, 'slot-1.json'), 'nope')
      writeFileSync(join(rootDir, 'slot-2.json'), ownerJson(222, 1))
      writeFileSync(join(rootDir, 'waiter-x.json'), ownerJson(333, 1))
      writeFileSync(join(rootDir, 'owner.break'), JSON.stringify({ pid: 444, acquiredAt: 1 }))

      expect((await readQualityGateAdmissionOwnerPids(rootDir)).sort((a, b) => a - b)).toEqual([111, 222])
      expect(await readQualityGateAdmissionOwnerPids(join(rootDir, 'missing'))).toEqual([])
    })
  })

  describe('slot count from config (PAN-4546)', () => {
    const request = { workspacePath: '/tmp/one', gateName: 'test', attempt: 1 }

    function configuredSlots(qualityGateSlots: number) {
      configMocks.loadGlobalConfigNoMigration.mockResolvedValue({ config: { resources: { qualityGateSlots } } })
    }

    /** deps() without the explicit `slots`, so the resolver decides. */
    function configDeps(rootDir: string, createdAt: number): QualityGateAdmissionDeps {
      const { slots: _slots, ...rest } = deps(rootDir)
      return { ...rest, now: () => createdAt }
    }

    beforeEach(() => {
      configMocks.loadGlobalConfigNoMigration.mockReset()
      configMocks.loadConfigNoMigration.mockReset()
    })

    it('admits as many concurrent requests as the global config allows', async () => {
      const rootDir = home()
      configuredSlots(3)
      // Started one after another: concurrent dynamic imports of a vi.mock'ed
      // module stall in Vitest. The three leases are still held at once.
      const handles = []
      for (const createdAt of [1, 2, 3]) {
        handles.push(await driveUntilResolved(acquireQualityGateAdmission(request, configDeps(rootDir, createdAt))))
      }

      expect(handles.map((handle) => handle.slot)).toEqual([0, 1, 2])
      expect(handles.every((handle) => handle.slots === 3)).toBe(true)
      expect(configMocks.loadConfigNoMigration).not.toHaveBeenCalled()
      for (const handle of handles) await handle.release()
    })

    it('falls back to two slots when the config loader rejects', async () => {
      const rootDir = home()
      configMocks.loadGlobalConfigNoMigration.mockRejectedValue(new Error('broken config.yaml'))
      const first = await driveUntilResolved(acquireQualityGateAdmission(request, configDeps(rootDir, 1)))
      const second = await driveUntilResolved(acquireQualityGateAdmission(request, configDeps(rootDir, 2)))
      const thirdPromise = acquireQualityGateAdmission(request, configDeps(rootDir, 3))
      let thirdSettled = false
      thirdPromise.finally(() => { thirdSettled = true }).catch(() => undefined)

      await drive(20)
      expect([first.slots, second.slots]).toEqual([2, 2])
      expect(thirdSettled).toBe(false)

      await first.release()
      const third = await driveUntilResolved(thirdPromise)
      expect(third.slot).toBe(0)
      await second.release()
      await third.release()
    })

    it('lets an explicit deps.slots win over the config', async () => {
      const rootDir = home()
      configuredSlots(3)
      const first = await driveUntilResolved(acquireQualityGateAdmission(request, { ...deps(rootDir), now: () => 1 }))
      const secondPromise = acquireQualityGateAdmission(request, { ...deps(rootDir), now: () => 2 })
      let secondResolved = false
      void secondPromise.then(() => { secondResolved = true })

      await drive(20)
      expect(secondResolved).toBe(false)
      expect(configMocks.loadGlobalConfigNoMigration).not.toHaveBeenCalled()

      await first.release()
      await (await driveUntilResolved(secondPromise)).release()
    })
  })

  describe('ticket durability (PAN-4610)', () => {
    const tornName = 'waiter-0000000000000000-0000000001-000000.json'

    it('leaves a young torn ticket for its writer to finish', async () => {
      const rootDir = home()
      writeFileSync(join(rootDir, tornName), '')

      const handle = await driveUntilResolved(acquireQualityGateAdmission(
        { workspacePath: '/tmp/one', gateName: 'test', attempt: 1 },
        deps(rootDir),
      ))
      await handle.release()

      expect(existsSync(join(rootDir, tornName))).toBe(true)
    })

    it('deletes a torn ticket older than the torn grace', async () => {
      const rootDir = home()
      const tornPath = join(rootDir, tornName)
      writeFileSync(tornPath, '')
      const sixtySecondsAgo = new Date(Date.now() - 60_000)
      utimesSync(tornPath, sixtySecondsAgo, sixtySecondsAgo)

      const handle = await driveUntilResolved(acquireQualityGateAdmission(
        { workspacePath: '/tmp/one', gateName: 'test', attempt: 1 },
        deps(rootDir),
      ))
      await handle.release()

      expect(existsSync(tornPath)).toBe(false)
    })

    it('recreates its own deleted ticket and keeps its FIFO place', async () => {
      const rootDir = home()
      const first = await driveUntilResolved(acquireQualityGateAdmission(
        { issueId: 'PAN-1', workspacePath: '/tmp/one', gateName: 'test', attempt: 1 },
        { ...deps(rootDir), now: () => 1 },
      ))

      const secondPromise = acquireQualityGateAdmission(
        { issueId: 'PAN-2', workspacePath: '/tmp/two', gateName: 'test', attempt: 1 },
        { ...deps(rootDir), now: () => 2 },
      )
      let secondResolved = false
      void secondPromise.then(() => { secondResolved = true })
      await driveUntil(() => ticketFilesCreatedAt(rootDir, 2).length === 1)

      for (const entry of ticketFilesCreatedAt(rootDir, 2)) unlinkSync(join(rootDir, entry))
      await driveUntil(() => ticketFilesCreatedAt(rootDir, 2).length === 1)

      const thirdPromise = acquireQualityGateAdmission(
        { issueId: 'PAN-3', workspacePath: '/tmp/three', gateName: 'test', attempt: 1 },
        { ...deps(rootDir), now: () => 3 },
      )
      let thirdResolved = false
      void thirdPromise.then(() => { thirdResolved = true })
      await driveUntil(() => ticketFilesCreatedAt(rootDir, 3).length === 1)

      await first.release()
      const second = await driveUntilResolved(secondPromise)
      expect(second.admittedAt).toBe(new Date(2).toISOString())
      expect(thirdResolved).toBe(false)
      expect(secondResolved).toBe(true)

      await second.release()
      const third = await driveUntilResolved(thirdPromise)
      await third.release()
    })

    it('leaves no temp files and sweeps the temp file of a dead pid', async () => {
      const rootDir = home()
      const deadTemp = join(rootDir, '.tmp-999999-0-waiter-x.json')
      writeFileSync(deadTemp, '')

      const handle = await driveUntilResolved(acquireQualityGateAdmission(
        { workspacePath: '/tmp/one', gateName: 'test', attempt: 1 },
        deps(rootDir),
      ))
      await handle.release()

      expect(existsSync(deadTemp)).toBe(false)
      expect(readdirSync(rootDir).filter((entry) => entry.startsWith('.tmp-'))).toEqual([])
    })
  })
})

describe('memory admission (PAN-5248)', () => {
  const GiB = 1024 ** 3
  const MiB = 1024 ** 2
  const keyed = { workspacePath: '/tmp/one', gateName: 'test', attempt: 1, footprintKey: 'tsc:tsconfig.json' }
  const OTHER_PID = 424_242

  function memDeps(
    rootDir: string,
    createdAt: number,
    available: () => number,
    extra: Partial<QualityGateAdmissionDeps> = {},
  ): QualityGateAdmissionDeps {
    return {
      ...deps(rootDir),
      now: () => createdAt,
      softReserveBytes: 12 * GiB,
      sampleMemory: async () => ({ memAvailableBytes: available(), memTotalBytes: 64 * GiB }),
      readTreeRssBytes: async () => 100 * MiB,
      ...extra,
    }
  }

  function settledFlag(promise: Promise<unknown>): () => boolean {
    let settled = false
    promise.finally(() => { settled = true }).catch(() => undefined)
    return () => settled
  }

  function ownerFiles(rootDir: string): string[] {
    return readdirSync(rootDir).filter((entry) => entry === 'owner.json' || /^slot-\d+\.json$/.test(entry))
  }

  /** A live slot-0 owner held by OTHER_PID with the given memory fields. */
  function writeOtherOwner(rootDir: string, fields: Record<string, unknown>): void {
    writeFileSync(join(rootDir, 'owner.json'), JSON.stringify({ ...JSON.parse(ownerJson(OTHER_PID, 1)), ...fields }))
  }

  const otherAlive = (pid: number) => pid === process.pid || pid === OTHER_PID

  it('waits on memory until MemAvailable recovers', async () => {
    const rootDir = home()
    let available = 13 * GiB
    const onWaiting = vi.fn()
    const promise = acquireQualityGateAdmission(keyed, memDeps(rootDir, 1, () => available, { onWaiting }))
    const settled = settledFlag(promise)

    await drive(10)
    expect(settled()).toBe(false)
    expect(onWaiting).toHaveBeenCalledTimes(1)
    expect(onWaiting).toHaveBeenCalledWith({
      kind: 'memory',
      memAvailableBytes: 13 * GiB,
      reservationsBytes: 0,
      footprintBytes: 2.5 * GiB,
      softReserveBytes: 12 * GiB,
    })

    available = 20 * GiB
    const handle = await driveUntilResolved(promise)
    expect(handle.footprintBytes).toBe(2.5 * GiB)
    await handle.release()
  })

  it('replays the incident: a second gate waits on memory with a slot free', async () => {
    const rootDir = home()
    const onWaiting = vi.fn()
    const slotDeps = (createdAt: number, extra: Partial<QualityGateAdmissionDeps> = {}) =>
      memDeps(rootDir, createdAt, () => 16 * GiB, { slots: 2, ...extra })

    const first = await driveUntilResolved(acquireQualityGateAdmission(keyed, slotDeps(1)))
    const secondPromise = acquireQualityGateAdmission(keyed, slotDeps(2, { onWaiting }))
    const thirdPromise = acquireQualityGateAdmission(keyed, slotDeps(3))
    const secondSettled = settledFlag(secondPromise)
    const thirdSettled = settledFlag(thirdPromise)

    await drive(20)
    expect(secondSettled()).toBe(false)
    expect(thirdSettled()).toBe(false)
    expect(ownerFiles(rootDir)).toEqual(['owner.json'])
    expect(readdirSync(rootDir).filter((entry) => entry.startsWith('waiter-'))).toHaveLength(2)
    // The first owner has grown 0 bytes above its baseline, so it still reserves its whole 2.5 GiB.
    expect(onWaiting).toHaveBeenCalledWith(expect.objectContaining({ kind: 'memory', reservationsBytes: 2.5 * GiB }))

    await first.release()
    const second = await driveUntilResolved(secondPromise)
    await second.release()
    const third = await driveUntilResolved(thirdPromise)
    await third.release()
  })

  it('uses a recorded peak instead of the default estimate', async () => {
    const rootDir = home()
    await recordGateFootprintPeak(keyed.footprintKey, 512 * MiB, rootDir)
    const handle = await driveUntilResolved(acquireQualityGateAdmission(keyed, memDeps(rootDir, 1, () => 13 * GiB)))
    expect(handle.footprintBytes).toBe(512 * MiB)
    await handle.release()

    const emptyRoot = home()
    let available = 13 * GiB
    const onWaiting = vi.fn()
    const promise = acquireQualityGateAdmission(keyed, memDeps(emptyRoot, 1, () => available, { onWaiting }))
    const settled = settledFlag(promise)
    await drive(10)
    expect(settled()).toBe(false)
    expect(onWaiting).toHaveBeenCalledWith(expect.objectContaining({ kind: 'memory', footprintBytes: 2.5 * GiB }))
    available = 20 * GiB
    await (await driveUntilResolved(promise)).release()
  })

  it('falls back to slot and CPU rules when memory is unreadable', async () => {
    for (const sampleMemory of [async () => null, async () => { throw new Error('no /proc/meminfo') }]) {
      const rootDir = home()
      const handle = await driveUntilResolved(acquireQualityGateAdmission(keyed, memDeps(rootDir, 1, () => 0, { sampleMemory })))
      expect(handle.footprintBytes).toBe(2.5 * GiB)
      await handle.release()
    }
  })

  it('counts nothing for an old-version owner without footprintBytes', async () => {
    const rootDir = home()
    writeFileSync(join(rootDir, 'owner.json'), ownerJson(OTHER_PID, 1))
    // 15 - 0 - 2.5 = 12.5 >= 12: admitted only if the old owner reserves 0.
    const handle = await driveUntilResolved(acquireQualityGateAdmission(
      keyed,
      memDeps(rootDir, 1, () => 15 * GiB, { slots: 2, isProcessAlive: otherAlive }),
    ))
    expect(handle.slot).toBe(1)
    await handle.release()
  })

  it('subtracts an owner\'s growth above its baseline, unless it reserves fully', async () => {
    const cases = [
      { fields: { footprintBytes: 2.5 * GiB, rssBaselineBytes: 1 * GiB }, treeRss: 1.1 * GiB, reserved: 2.4 * GiB },
      { fields: { footprintBytes: 2.5 * GiB, rssBaselineBytes: 1 * GiB, fullReservation: true }, treeRss: 3 * GiB, reserved: 2.5 * GiB },
    ]
    for (const { fields, treeRss, reserved } of cases) {
      const rootDir = home()
      writeOtherOwner(rootDir, fields)
      const onWaiting = vi.fn()
      const promise = acquireQualityGateAdmission(keyed, memDeps(rootDir, 1, () => 16 * GiB, {
        slots: 2,
        isProcessAlive: otherAlive,
        readTreeRssBytes: async (pid) => (pid === OTHER_PID ? treeRss : 100 * MiB),
        onWaiting,
      }))
      const settled = settledFlag(promise)
      await drive(10)
      expect(settled()).toBe(false)
      const reason = onWaiting.mock.calls[0]![0]
      expect(reason.kind).toBe('memory')
      expect(reason.reservationsBytes).toBeCloseTo(reserved, 0)

      unlinkSync(join(rootDir, 'owner.json'))
      await (await driveUntilResolved(promise)).release()
    }
  })

  async function driveUntilRejected(promise: Promise<unknown>): Promise<unknown> {
    let error: unknown
    let done = false
    promise.then(() => { done = true }, (reason: unknown) => { error = reason; done = true })
    await driveUntil(() => done)
    return error
  }

  it('re-checks memory after the settle and gives the slot back when it dropped', async () => {
    const rootDir = home()
    let reads = 0
    let recovered = false
    const onWaiting = vi.fn()
    const promise = acquireQualityGateAdmission(keyed, memDeps(rootDir, 1, () => {
      reads++
      return reads === 1 || recovered ? 20 * GiB : 13 * GiB
    }, { onWaiting }))
    const settled = settledFlag(promise)

    await drive(15)
    expect(reads).toBeGreaterThan(2)
    expect(settled()).toBe(false)
    expect(ownerFiles(rootDir)).toEqual([])
    expect(readdirSync(rootDir).filter((entry) => entry.startsWith('waiter-'))).toHaveLength(1)
    expect(onWaiting).toHaveBeenCalledWith(expect.objectContaining({ kind: 'memory', memAvailableBytes: 13 * GiB }))

    recovered = true
    await (await driveUntilResolved(promise)).release()
  })

  it('times out with lastWaitReason memory when memory never recovers', async () => {
    const rootDir = home()
    let clock = 0
    const error = await driveUntilRejected(acquireQualityGateAdmission(keyed, memDeps(rootDir, 1, () => {
      clock += 1_000
      return 13 * GiB
    }, { now: () => clock, maxWaitMs: 5_000 })))

    expect(error).toBeInstanceOf(QualityGateAdmissionTimeoutError)
    expect(error).toMatchObject({ lastWaitReason: 'memory', lastMemory: { memAvailableBytes: 13 * GiB } })
    expect(readdirSync(rootDir).filter((entry) => entry.startsWith('waiter-'))).toEqual([])
  })

  it('times out with lastWaitReason cpu when CPU never recovers', async () => {
    const rootDir = home()
    let clock = 0
    const error = await driveUntilRejected(acquireQualityGateAdmission(keyed, memDeps(rootDir, 1, () => 64 * GiB, {
      now: () => clock,
      maxWaitMs: 5_000,
      samplePressure: async () => {
        clock += 1_000
        return high
      },
    })))

    expect(error).toBeInstanceOf(QualityGateAdmissionTimeoutError)
    expect(error).toMatchObject({ lastWaitReason: 'cpu', lastMemory: undefined })
  })

  it('records a peak that the next acquire for the same key uses', async () => {
    const rootDir = home()
    const handle = await driveUntilResolved(acquireQualityGateAdmission(keyed, memDeps(rootDir, 1, () => 64 * GiB)))
    await handle.recordPeak(3 * GiB)
    expect(readdirSync(join(rootDir, 'footprints')).filter((entry) => !entry.startsWith('.tmp-'))).toHaveLength(1)
    await handle.release()

    const next = await driveUntilResolved(acquireQualityGateAdmission(keyed, memDeps(rootDir, 2, () => 64 * GiB)))
    expect(next.footprintBytes).toBe(3 * GiB)
    expect(JSON.parse(readFileSync(join(rootDir, 'owner.json'), 'utf8')).footprintBytes).toBe(3 * GiB)
    await next.release()

    const unkeyedRoot = home()
    const unkeyed = await driveUntilResolved(acquireQualityGateAdmission(
      { workspacePath: '/tmp/one', gateName: 'test', attempt: 1 },
      { ...deps(unkeyedRoot), now: () => 1 },
    ))
    await unkeyed.recordPeak(3 * GiB)
    expect(unkeyed.footprintBytes).toBe(0)
    expect(existsSync(join(unkeyedRoot, 'footprints'))).toBe(false)
    await unkeyed.release()
  })
})

describe('sampleQualityGatePressure (PAN-4311)', () => {
  // Identical counters before and after the (skipped) 250 ms wait: 0% utilization.
  const idleCpus = Array.from({ length: 4 }, () => ({
    model: 'cpu', speed: 1, times: { user: 100, nice: 0, sys: 100, idle: 800, irq: 0 },
  }))
  const noWait = async () => undefined

  beforeEach(() => {
    osMocks.cpus.mockReturnValue(idleCpus)
  })

  afterEach(async () => {
    const actual = await vi.importActual<typeof import('node:os')>('node:os')
    osMocks.cpus.mockImplementation(actual.cpus)
    osMocks.loadavg.mockImplementation(actual.loadavg)
  })

  it('is pressured when PSI some avg10 reaches 25, even at low utilization and load', async () => {
    osMocks.loadavg.mockReturnValue([0.4, 0, 0])
    const sample = await sampleQualityGatePressure(noWait, async () => ({ someAvg10: 30, someAvg60: 10 }))

    expect(sample).toEqual({ cpuUtilization: 0, loadPerCore: 0.1, psiSomeAvg10: 30, pressured: true })
  })

  it('lets PSI win over a high load per core', async () => {
    osMocks.loadavg.mockReturnValue([12, 0, 0])
    const sample = await sampleQualityGatePressure(noWait, async () => ({ someAvg10: 10, someAvg60: 10 }))

    expect(sample).toMatchObject({ loadPerCore: 3, psiSomeAvg10: 10, pressured: false })
  })

  it('falls back to load per core when PSI is unavailable', async () => {
    osMocks.loadavg.mockReturnValue([4.8, 0, 0])
    const sample = await sampleQualityGatePressure(noWait, async () => ({ someAvg10: null, someAvg60: null }))

    expect(sample).toMatchObject({ loadPerCore: 1.2, psiSomeAvg10: null, pressured: true })
  })
})
