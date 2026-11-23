import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
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
  readQualityGateQueue,
  sampleQualityGatePressure,
  type QualityGateAdmissionDeps,
  type QualityGatePressureSample,
} from '../../../../src/lib/cloister/quality-gate-admission.js'
import { QUEUE_CPU_MARKER_FILE, resolveQualityGateCpuSettings } from '../../../../src/lib/cloister/quality-gate-cpu.js'
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
    // PAN-5520: explicit, so only the config cases reach the mocked loader (concurrent imports of it stall).
    psiStartAvg10: 25,
    cpuBypassMs: 10 * 60_000,
  }
}

// Captured before vi.useFakeTimers() so they always schedule and read real wall-clock time.
const nativeSetTimeout = globalThis.setTimeout
const nativeNow = Date.now

/**
 * PAN-5459: real time one condition wait may take. A turn count is not safe: on a
 * loaded runner each fs op in the admission loop eats more turns. Fake time does
 * not count against it, and a wait that passes returns on its first true turn.
 */
const DRIVE_BUDGET_MS = 4_000

// Several condition waits per test can each use most of DRIVE_BUDGET_MS on a loaded runner.
vi.setConfig({ testTimeout: 30_000 })

/** One turn of the admission loop. */
async function turn(): Promise<void> {
  // The admission loop awaits real fs promises that resolve on the libuv
  // threadpool; on a loaded host a bare setImmediate spin exhausts every
  // attempt before a single fs op completes. A 1ms real yield per turn
  // gives the threadpool wall-clock time without unfaking tested delays.
  await new Promise((resolve) => nativeSetTimeout(resolve, 1))
  await realSetImmediate()
  await vi.runOnlyPendingTimersAsync()
}

/** Drive the admission loop until done() holds or DRIVE_BUDGET_MS of real time passes. Never asserts. */
async function drive(done: () => boolean): Promise<void> {
  const deadline = nativeNow() + DRIVE_BUDGET_MS
  while (!done() && nativeNow() < deadline) await turn()
}

async function driveUntil(done: () => boolean): Promise<void> {
  await drive(done)
  expect(done(), `condition not met within ${DRIVE_BUDGET_MS} ms of real time`).toBe(true)
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
      // Both acquires run in one process; let the first ticket land before the second
      // starts, or the threadpool can publish the second first and it takes slot 0.
      await driveUntil(() => ticketFilesCreatedAt(rootDir, 1).length === 1 || existsSync(join(rootDir, 'owner.json')))
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

      // B has reached the CPU check and seen high pressure.
      await driveUntil(() => samplePressure.mock.calls.length > 0)
      expect(secondResolved).toBe(false)
      expect(existsSync(join(rootDir, 'slot-1.json'))).toBe(false)

      await first.release()
      // A pass that listed slot 0 as held may still be in flight. Two more samples mean
      // the later pass started after the release, so B sees slot 0 free once pressure clears.
      const samplesAtRelease = samplePressure.mock.calls.length
      await driveUntil(() => samplePressure.mock.calls.length >= samplesAtRelease + 2)
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
      const onWaiting = vi.fn()
      const admission = acquireQualityGateAdmission(request, { ...deps(rootDir), now: () => 10_000, onWaiting })
      let resolved = false
      void admission.then(() => { resolved = true })

      await driveUntil(() => onWaiting.mock.calls.some(([reason]) => reason.kind === 'slots'))
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
      const onThirdWaiting = vi.fn()
      const thirdPromise = acquireQualityGateAdmission(request, { ...configDeps(rootDir, 3), onWaiting: onThirdWaiting })
      let thirdSettled = false
      thirdPromise.finally(() => { thirdSettled = true }).catch(() => undefined)

      await driveUntil(() => onThirdWaiting.mock.calls.some(([reason]) => reason.kind === 'slots'))
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
      const onWaiting = vi.fn()
      const secondPromise = acquireQualityGateAdmission(request, { ...deps(rootDir), now: () => 2, onWaiting })
      let secondResolved = false
      void secondPromise.then(() => { secondResolved = true })

      await driveUntil(() => onWaiting.mock.calls.some(([reason]) => reason.kind === 'slots'))
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
    let reads = 0
    const onWaiting = vi.fn()
    const promise = acquireQualityGateAdmission(keyed, memDeps(rootDir, 1, () => {
      reads++
      return available
    }, { onWaiting }))
    const settled = settledFlag(promise)

    await drive(() => onWaiting.mock.calls.length > 0)
    // Two more polls read memory after the first report, so toHaveBeenCalledTimes(1) proves no repeat report.
    const readsAtReport = reads
    await drive(() => reads >= readsAtReport + 2)
    expect(reads).toBeGreaterThanOrEqual(readsAtReport + 2)
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

    await drive(() => onWaiting.mock.calls.length > 0
      && readdirSync(rootDir).filter((entry) => entry.startsWith('waiter-')).length === 2)
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
    await drive(() => onWaiting.mock.calls.length > 0)
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
      await drive(() => onWaiting.mock.calls.length > 0)
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

    await drive(() => reads > 2)
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

async function driveUntilRejected(promise: Promise<unknown>): Promise<unknown> {
  let error: unknown
  let done = false
  promise.then(() => { done = true }, (reason: unknown) => { error = reason; done = true })
  await driveUntil(() => done)
  return error
}

describe('head-of-line fairness (PAN-5285)', () => {
  const GiB = 1024 ** 3
  const MiB = 1024 ** 2
  const OTHER_PID = 525_285
  const big = { workspacePath: '/tmp/big', gateName: 'vitest', attempt: 1, footprintKey: 'vitest:.:suite', issueId: 'PAN-1' }
  const small = { workspacePath: '/tmp/small', gateName: 'tsc', attempt: 1, footprintKey: 'tsc:small.json' }
  const otherAlive = (pid: number) => pid === process.pid || pid === OTHER_PID

  /** Shared clock, 64 GiB host, soft reserve 12 GiB, hard reserve 4 GiB, a 1 s bypass bound. */
  function fairDeps(
    rootDir: string,
    clock: () => number,
    available: () => number,
    extra: Partial<QualityGateAdmissionDeps> = {},
  ): QualityGateAdmissionDeps {
    return {
      ...deps(rootDir),
      now: clock,
      softReserveBytes: 12 * GiB,
      hardReserveBytes: 4 * GiB,
      headBypassMs: 1_000,
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

  /** The parsed waiter ticket for `gateName`, or undefined. */
  function waiterTicket(rootDir: string, gateName: string): Record<string, unknown> | undefined {
    for (const entry of readdirSync(rootDir).filter((name) => name.startsWith('waiter-') && name.endsWith('.json'))) {
      try {
        const ticket = JSON.parse(readFileSync(join(rootDir, entry), 'utf8'))
        if (ticket.gateName === gateName) return ticket
      } catch {
        // Mid-replace; the next drive step reads it again.
      }
    }
    return undefined
  }

  /** The memoryBlockedSince a waiter ticket for `gateName` recorded, or undefined. */
  function blockedSince(rootDir: string, gateName: string): number | undefined {
    const since = waiterTicket(rootDir, gateName)?.memoryBlockedSince
    return typeof since === 'number' ? since : undefined
  }

  /** The wait-reason kind a waiter ticket for `gateName` recorded, or undefined. */
  function waitKind(rootDir: string, gateName: string): string | undefined {
    const wait = waiterTicket(rootDir, gateName)?.wait as { reason?: { kind?: unknown } } | undefined
    return typeof wait?.reason?.kind === 'string' ? wait.reason.kind : undefined
  }

  /**
   * Attach a rejection handler now. CI retries a failed test once, and a failed
   * attempt that never reached its own handler would leave this acquire polling a
   * deleted root, which surfaces as an unhandled rejection. Assertions still see
   * the promise's real outcome.
   */
  function pending<T>(promise: Promise<T>): Promise<T> {
    promise.catch(() => undefined)
    return promise
  }

  async function seedPeaks(rootDir: string): Promise<void> {
    await recordGateFootprintPeak(big.footprintKey, 9 * GiB, rootDir)
    await recordGateFootprintPeak(small.footprintKey, 100 * MiB, rootDir)
  }

  it('a memory-blocked head lets a fitting second waiter in', async () => {
    const rootDir = home()
    await seedPeaks(rootDir)
    let clock = 1
    const headPromise = acquireQualityGateAdmission(big, fairDeps(rootDir, () => clock, () => 16 * GiB))
    const headSettled = settledFlag(headPromise)
    await driveUntil(() => blockedSince(rootDir, 'vitest') === 1)
    clock = 2
    const second = await driveUntilResolved(acquireQualityGateAdmission(small, fairDeps(rootDir, () => clock, () => 16 * GiB)))

    expect(headSettled()).toBe(false)
    expect(second.admittedAlone).toBe(false)
    expect(second.footprintBytes).toBe(100 * MiB)
    await second.release()

    // Past the bound with the slots empty, the head now starts alone.
    clock = 5_000
    const head = await driveUntilResolved(headPromise)
    expect(head.admittedAlone).toBe(true)
    await head.release()
  })

  it('keeps FIFO when the waiter ahead would fit', async () => {
    const rootDir = home()
    await seedPeaks(rootDir)
    let pressured = true
    const cpu = { slots: 2, samplePressure: async () => (pressured ? high : low) }
    const onWaiting = vi.fn()
    const onFirstWaiting = vi.fn()
    const firstPromise = pending(acquireQualityGateAdmission(small, fairDeps(rootDir, () => 1, () => 16 * GiB, { ...cpu, onWaiting: onFirstWaiting })))
    await driveUntil(() => onFirstWaiting.mock.calls.some(([reason]) => reason.kind === 'cpu'))
    const secondPromise = acquireQualityGateAdmission(small, fairDeps(rootDir, () => 2, () => 16 * GiB, { ...cpu, onWaiting }))
    const secondSettled = settledFlag(secondPromise)
    await drive(() => onWaiting.mock.calls.length > 0)

    // The first waiter fits memory and waits on CPU, so the second may not pass it.
    expect(secondSettled()).toBe(false)
    expect(onWaiting).toHaveBeenCalledWith(expect.objectContaining({ kind: 'queue', position: 1 }))
    pressured = false
    await (await driveUntilResolved(firstPromise)).release()
    await (await driveUntilResolved(secondPromise)).release()
  })

  it('admits an unfittable head alone once it is past the bound and the slots are empty', async () => {
    const rootDir = home()
    await seedPeaks(rootDir)
    writeFileSync(join(rootDir, 'owner.json'), ownerJson(OTHER_PID, 1))
    let clock = 1
    const onSecondWaiting = vi.fn()
    // staleMs well above the clock, so the held slot is not reclaimed as stale.
    const both = { slots: 2, isProcessAlive: otherAlive, staleMs: 60_000 }
    const headPromise = acquireQualityGateAdmission(big, fairDeps(rootDir, () => clock, () => 16 * GiB, both))
    const headSettled = settledFlag(headPromise)
    // Advance the clock only once the head has recorded its memory block at t=1.
    await driveUntil(() => blockedSince(rootDir, 'vitest') === 1)
    clock = 2_000
    const secondPromise = acquireQualityGateAdmission(small, fairDeps(rootDir, () => clock, () => 16 * GiB, { ...both, onWaiting: onSecondWaiting }))
    const secondSettled = settledFlag(secondPromise)
    await drive(() => onSecondWaiting.mock.calls.length > 0)

    // Past the bound, nobody passes the head while the held slot drains.
    expect(headSettled()).toBe(false)
    expect(secondSettled()).toBe(false)
    expect(onSecondWaiting).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'queue', headAlone: true, blocker: { gateName: 'vitest', issueId: 'PAN-1', workspacePath: '/tmp/big' },
    }))

    unlinkSync(join(rootDir, 'owner.json'))
    const head = await driveUntilResolved(headPromise)
    expect(head.admittedAlone).toBe(true)
    expect(head.footprintBytes).toBe(9 * GiB)
    expect(JSON.parse(readFileSync(join(rootDir, 'owner.json'), 'utf8'))).toMatchObject({ admittedAlone: true })
    await head.release()
    await (await driveUntilResolved(secondPromise)).release()
  })

  it('never admits a head alone below the hard reserve, and lets smaller gates pass it instead', async () => {
    const rootDir = home()
    await seedPeaks(rootDir)
    let clock = 1
    // Alone, the 9 GiB head would leave 3.5 GiB, under the 4 GiB hard reserve.
    const available = () => 12.5 * GiB
    // Two slots, so the head only ever waits on memory, never on the slot the second gate holds.
    const headPromise = pending(acquireQualityGateAdmission(big, fairDeps(rootDir, () => clock, available, { maxWaitMs: 10_000, slots: 2 })))
    // The head records its memory block at t=1, so at t=5000 it is past the 1 s bound.
    await driveUntil(() => blockedSince(rootDir, 'vitest') === 1)
    clock = 5_000

    const second = await driveUntilResolved(acquireQualityGateAdmission(small, fairDeps(rootDir, () => clock, available, { slots: 2 })))
    expect(second.admittedAlone).toBe(false)
    await second.release()

    clock = 20_000
    expect(await driveUntilRejected(headPromise)).toMatchObject({ lastWaitReason: 'memory' })
  })

  it('counts the bound from the head\'s first memory block, not from when it queued', async () => {
    const rootDir = home()
    await seedPeaks(rootDir)
    writeFileSync(join(rootDir, 'owner.json'), ownerJson(OTHER_PID, 1))
    let clock = 1
    const held = { isProcessAlive: otherAlive, staleMs: 600_000 }
    const headPromise = acquireQualityGateAdmission(big, fairDeps(rootDir, () => clock, () => 16 * GiB, held))
    const headSettled = settledFlag(headPromise)
    // Queued at t=1 and waiting on the held slot, not on memory.
    await driveUntil(() => waitKind(rootDir, 'vitest') === 'slots')
    // Long past the bound in queue age, but it has waited on the slot, not on memory.
    clock = 10_000
    unlinkSync(join(rootDir, 'owner.json'))
    await driveUntil(() => blockedSince(rootDir, 'vitest') === 10_000)
    expect(headSettled()).toBe(false)

    clock = 10_500
    const second = await driveUntilResolved(acquireQualityGateAdmission(small, fairDeps(rootDir, () => clock, () => 16 * GiB, held)))
    expect(headSettled()).toBe(false)
    await second.release()

    clock = 12_000
    const head = await driveUntilResolved(headPromise)
    expect(head.admittedAlone).toBe(true)
    await head.release()
  })

  it('passes an older-version head that looks as if it fits but stays queued past the grace', async () => {
    const rootDir = home()
    await seedPeaks(rootDir)
    // Froze 3 GiB under a 14 GiB reserve: by today's 12 GiB reserve it fits, yet it never starts.
    writeFileSync(join(rootDir, 'waiter-0000000000000000-0000525285-000000.json'), JSON.stringify({
      ...big, ticketId: '0000000000000000-0000525285-000000', pid: OTHER_PID, createdAt: 0, footprintBytes: 3 * GiB,
    }))
    let clock = 1
    const onWaiting = vi.fn()
    const promise = acquireQualityGateAdmission(small, fairDeps(rootDir, () => clock, () => 16 * GiB, { isProcessAlive: otherAlive, onWaiting }))
    const settled = settledFlag(promise)
    // The grace starts at t=1, at the first queue check, which reports `queue`.
    await driveUntil(() => onWaiting.mock.calls.some(([reason]) => reason.kind === 'queue'))
    expect(settled()).toBe(false)

    clock = 40_000
    await (await driveUntilResolved(promise)).release()
  })

  it('clamps the alone footprint against the hard reserve, not the soft reserve', async () => {
    const rootDir = home()
    await seedPeaks(rootDir)
    let clock = 1
    // 16 GiB host: a soft-reserve clamp would cut the 9 GiB estimate to 4 GiB and pass 10 - 4 >= 4.
    let reads = 0
    const promise = pending(acquireQualityGateAdmission(big, fairDeps(rootDir, () => clock, () => 10 * GiB, {
      maxWaitMs: 10_000,
      sampleMemory: async () => {
        reads++
        return { memAvailableBytes: 10 * GiB, memTotalBytes: 16 * GiB }
      },
    })))
    await driveUntil(() => blockedSince(rootDir, 'vitest') === 1)
    clock = 5_000
    // Two more reads: a whole poll pass ran past the bound and still did not start alone.
    const readsAtBound = reads
    await driveUntil(() => reads >= readsAtBound + 2)
    expect(readdirSync(rootDir).filter((entry) => entry === 'owner.json')).toEqual([])

    clock = 20_000
    expect(await driveUntilRejected(promise)).toMatchObject({ lastWaitReason: 'memory' })
  })

  it('gives an alone slot back when memory drops below the hard reserve during the settle', async () => {
    const rootDir = home()
    await seedPeaks(rootDir)
    let clock = 1
    let dropWhileHeld = true
    let droppedOnce = false
    const sampleMemory = async () => {
      const held = existsSync(join(rootDir, 'owner.json'))
      if (held && dropWhileHeld) droppedOnce = true
      // While it holds the slot, MemAvailable falls to 12 GiB: 12 - 9 = 3 GiB, under the 4 GiB hard reserve.
      return { memAvailableBytes: held && dropWhileHeld ? 12 * GiB : 16 * GiB, memTotalBytes: 64 * GiB }
    }
    const promise = acquireQualityGateAdmission(big, fairDeps(rootDir, () => clock, () => 16 * GiB, { sampleMemory }))
    const settled = settledFlag(promise)
    await driveUntil(() => blockedSince(rootDir, 'vitest') === 1)
    clock = 5_000
    // The settle re-check saw the drop and gave the slot back.
    await driveUntil(() => droppedOnce && !existsSync(join(rootDir, 'owner.json')))
    expect(settled()).toBe(false)

    dropWhileHeld = false
    const handle = await driveUntilResolved(promise)
    expect(handle.admittedAlone).toBe(true)
    await handle.release()
  })

  it('passes an older-version head that froze a huge estimate, even past the bound', async () => {
    const rootDir = home()
    await seedPeaks(rootDir)
    writeFileSync(join(rootDir, 'waiter-0000000000000000-0000525285-000000.json'), JSON.stringify({
      ...big, ticketId: '0000000000000000-0000525285-000000', pid: OTHER_PID, createdAt: 0, footprintBytes: 9 * GiB,
    }))
    const handle = await driveUntilResolved(acquireQualityGateAdmission(small, fairDeps(rootDir, () => 60_000, () => 16 * GiB, {
      isProcessAlive: otherAlive,
    })))
    expect(handle.admittedAlone).toBe(false)
    await handle.release()
  })

  it('re-reads the estimate every poll, so a corrected footprint unblocks a queued waiter', async () => {
    const rootDir = home()
    let estimate = 9 * GiB
    const onWaiting = vi.fn()
    const promise = acquireQualityGateAdmission(big, fairDeps(rootDir, () => 1, () => 16 * GiB, {
      readFootprintEstimate: async () => estimate,
      onWaiting,
    }))
    const settled = settledFlag(promise)
    // The 9 GiB estimate blocked it on memory.
    await driveUntil(() => onWaiting.mock.calls.some(([reason]) => reason.kind === 'memory'))
    expect(settled()).toBe(false)

    estimate = 1 * GiB
    const handle = await driveUntilResolved(promise)
    expect(handle.footprintBytes).toBe(1 * GiB)
    expect(handle.admittedAlone).toBe(false)
    await handle.release()
  })

  it('re-reads the soft reserve every poll, so a lowered reserve unblocks a queued waiter', async () => {
    const rootDir = home()
    const mid = { ...small, footprintKey: 'tsc:mid.json' }
    await recordGateFootprintPeak(mid.footprintKey, 5 * GiB, rootDir)
    let softGb = 12
    configMocks.loadGlobalConfigNoMigration.mockReset()
    configMocks.loadGlobalConfigNoMigration.mockImplementation(async () => ({
      config: { resources: { governorSoftReserveGb: softGb, governorHardReserveGb: 4 } },
    }))
    try {
      // Config-resolved reserves: no softReserveBytes or hardReserveBytes in deps.
      const { softReserveBytes: _soft, hardReserveBytes: _hard, ...configured } = fairDeps(rootDir, () => 1, () => 16 * GiB)
      const onWaiting = vi.fn()
      const promise = acquireQualityGateAdmission(mid, { ...configured, onWaiting })
      const settled = settledFlag(promise)
      await drive(() => onWaiting.mock.calls.length > 0)
      // 16 - 5 = 11 GiB is under the 12 GiB reserve.
      expect(settled()).toBe(false)
      expect(onWaiting).toHaveBeenCalledWith(expect.objectContaining({ kind: 'memory', softReserveBytes: 12 * GiB }))

      softGb = 10
      await (await driveUntilResolved(promise)).release()
    } finally {
      configMocks.loadGlobalConfigNoMigration.mockReset()
    }
  })

  it('writes the wait reason into the ticket for status readers', async () => {
    const rootDir = home()
    await seedPeaks(rootDir)
    let clock = 1
    const promise = pending(acquireQualityGateAdmission(big, fairDeps(rootDir, () => clock, () => 16 * GiB, {
      maxWaitMs: 500, headBypassMs: 60_000,
    })))
    await driveUntil(() => waiterTicket(rootDir, 'vitest')?.wait !== undefined)

    const { waiters } = await readQualityGateQueue({ rootDir, slots: 1, isProcessAlive: (pid) => pid === process.pid })
    expect(waiters).toHaveLength(1)
    expect(waiters[0]).toMatchObject({
      gateName: 'vitest',
      issueId: 'PAN-1',
      footprintBytes: 9 * GiB,
      wait: { since: 1, reason: { kind: 'memory', footprintBytes: 9 * GiB, softReserveBytes: 12 * GiB } },
    })

    clock = 1_000
    await driveUntilRejected(promise)
  })
})

describe('CPU bypass (PAN-5520)', () => {
  const OTHER_PID = 515_151
  const request = { issueId: 'PAN-1', workspacePath: '/tmp/one', gateName: 'vitest', attempt: 1 }

  /** deps() under sustained CPU pressure with a 1 s bound and an injected clock. */
  function cpuDeps(rootDir: string, clock: () => number, extra: Partial<QualityGateAdmissionDeps> = {}): QualityGateAdmissionDeps {
    return { ...deps(rootDir), now: clock, cpuBypassMs: 1_000, samplePressure: vi.fn(async () => high), ...extra }
  }

  function settledFlag(promise: Promise<unknown>): () => boolean {
    let settled = false
    promise.then(() => { settled = true }, () => { settled = true })
    return () => settled
  }

  /** The cpuBlockedSince the waiter ticket recorded, or undefined. */
  function cpuBlockedSince(rootDir: string): number | undefined {
    for (const entry of readdirSync(rootDir).filter((name) => name.startsWith('waiter-') && name.endsWith('.json'))) {
      try {
        const since = JSON.parse(readFileSync(join(rootDir, entry), 'utf8')).cpuBlockedSince
        if (typeof since === 'number') return since
      } catch {
        // Mid-replace; the next drive step reads it again.
      }
    }
    return undefined
  }

  /** PAN-5588: the queue's CPU marker, `cpu-blocked-since.json`'s `since`, or undefined when absent. */
  function markerSince(rootDir: string): number | undefined {
    try {
      const since = JSON.parse(readFileSync(join(rootDir, QUEUE_CPU_MARKER_FILE), 'utf8')).since
      return typeof since === 'number' ? since : undefined
    } catch {
      return undefined
    }
  }

  /** A field of the waiter ticket for `gateName`, or undefined. */
  function ticketField(rootDir: string, gateName: string, field: string): unknown {
    for (const entry of readdirSync(rootDir).filter((name) => name.startsWith('waiter-') && name.endsWith('.json'))) {
      try {
        const ticket = JSON.parse(readFileSync(join(rootDir, entry), 'utf8'))
        if (ticket.gateName === gateName) return ticket[field]
      } catch {
        // Mid-replace; the next drive step reads it again.
      }
    }
    return undefined
  }

  it('admits a head alone once its CPU block outlasts the bound, though pressure never clears', async () => {
    const rootDir = home()
    let clock = 1
    const samplePressure = vi.fn(async () => high)
    const headPromise = acquireQualityGateAdmission(request, cpuDeps(rootDir, () => clock, { samplePressure }))
    const headSettled = settledFlag(headPromise)
    await driveUntil(() => cpuBlockedSince(rootDir) === 1)
    clock = 900
    await drive(() => samplePressure.mock.calls.length >= 5)
    expect(headSettled()).toBe(false)

    clock = 2_000
    const head = await driveUntilResolved(headPromise)
    expect(head.cpuBypassed).toBe(true)
    expect(head.admittedAlone).toBe(false)
    expect(JSON.parse(readFileSync(join(rootDir, 'owner.json'), 'utf8'))).toMatchObject({ cpuBypassed: true })
    expect(samplePressure.mock.results.every((result) => result.type === 'return')).toBe(true)
    await head.release()
  })

  it('keeps the CPU clock when a later sample is low, so a flapping sample cannot hold the head', async () => {
    const rootDir = home()
    let clock = 1
    // Low before the settle, high after it: without the bound this head would loop forever.
    let call = 0
    const samplePressure = vi.fn(async () => (call++ === 0 ? high : call % 2 === 0 ? low : high))
    const headPromise = acquireQualityGateAdmission(request, cpuDeps(rootDir, () => clock, { samplePressure }))
    await driveUntil(() => cpuBlockedSince(rootDir) === 1)
    await driveUntil(() => markerSince(rootDir) === 1)
    await drive(() => samplePressure.mock.calls.length >= 6)
    expect(cpuBlockedSince(rootDir)).toBe(1)

    clock = 2_000
    expect((await driveUntilResolved(headPromise)).cpuBypassed).toBe(true)
    await (await headPromise).release()
  })

  it('does not admit a CPU-blocked head past the bound while another gate holds a slot', async () => {
    const rootDir = home()
    writeFileSync(join(rootDir, 'owner.json'), ownerJson(OTHER_PID, 1))
    let clock = 1
    const samplePressure = vi.fn(async () => high)
    const headPromise = acquireQualityGateAdmission(request, cpuDeps(rootDir, () => clock, {
      slots: 2,
      staleMs: 60_000,
      isProcessAlive: (pid) => pid === process.pid || pid === OTHER_PID,
      samplePressure,
    }))
    const headSettled = settledFlag(headPromise)
    await driveUntil(() => cpuBlockedSince(rootDir) === 1)
    clock = 5_000
    // Past the bound with a slot held, the head keeps sampling and waiting on CPU.
    const calls = samplePressure.mock.calls.length
    await driveUntil(() => samplePressure.mock.calls.length >= calls + 3)
    expect(headSettled()).toBe(false)

    unlinkSync(join(rootDir, 'owner.json'))
    const head = await driveUntilResolved(headPromise)
    expect(head.cpuBypassed).toBe(true)
    expect(head.slot).toBe(0)
    await head.release()
  })

  it('keeps FIFO behind a CPU-blocked head, and the next head inherits the queue\'s CPU block (PAN-5588)', async () => {
    const rootDir = home()
    let clock = 1
    const headPromise = acquireQualityGateAdmission(request, cpuDeps(rootDir, () => clock, { slots: 2 }))
    await driveUntil(() => cpuBlockedSince(rootDir) === 1)
    const onWaiting = vi.fn()
    const secondPromise = acquireQualityGateAdmission({ ...request, gateName: 'tsc' }, cpuDeps(rootDir, () => clock, { slots: 2, onWaiting }))
    const secondSettled = settledFlag(secondPromise)
    await driveUntil(() => onWaiting.mock.calls.length > 0)
    expect(onWaiting).toHaveBeenCalledWith(expect.objectContaining({ kind: 'queue', position: 1 }))

    clock = 2_000
    const head = await driveUntilResolved(headPromise)
    expect(head.cpuBypassed).toBe(true)
    expect(markerSince(rootDir)).toBe(1)
    // The second gate is now head with a slot held: it samples CPU itself but cannot bypass alone yet.
    await drive(() => cpuBlockedSince(rootDir) === 2_000)
    expect(cpuBlockedSince(rootDir)).toBe(2_000)
    expect(secondSettled()).toBe(false)

    await head.release()
    // The queue's marker still dates to clock 1, so the second head does not wait a second bound.
    expect((await driveUntilResolved(secondPromise)).cpuBypassed).toBe(true)
    await (await secondPromise).release()
  })

  it('the next head starts alone without a second wait when slots: 1 (PAN-5588)', async () => {
    const rootDir = home()
    let clock = 1
    const headPromise = acquireQualityGateAdmission(request, cpuDeps(rootDir, () => clock, { slots: 1 }))
    await driveUntil(() => cpuBlockedSince(rootDir) === 1)
    const samplePressure = vi.fn(async () => high)
    const secondPromise = acquireQualityGateAdmission({ ...request, gateName: 'tsc' }, cpuDeps(rootDir, () => clock, { slots: 1, samplePressure }))
    const secondSettled = settledFlag(secondPromise)
    // Queued behind the head without its own footprintKey, the second waiter never reaches the CPU section.
    await drive(() => readdirSync(rootDir).filter((entry) => entry.startsWith('waiter-')).length === 2)
    expect(secondSettled()).toBe(false)
    expect(samplePressure).not.toHaveBeenCalled()

    clock = 2_000
    const head = await driveUntilResolved(headPromise)
    expect(head.cpuBypassed).toBe(true)
    await head.release()

    const second = await driveUntilResolved(secondPromise)
    expect(second.cpuBypassed).toBe(true)
    expect(samplePressure).toHaveBeenCalled()
    await second.release()
  })

  it('never runs two gates at once under sustained pressure (PAN-5588)', async () => {
    const rootDir = home()
    let clock = 1
    const firstPromise = acquireQualityGateAdmission({ ...request, gateName: 'first' }, cpuDeps(rootDir, () => clock, { slots: 2 }))
    await driveUntil(() => cpuBlockedSince(rootDir) === 1)
    const secondSamplePressure = vi.fn(async () => high)
    const secondPromise = acquireQualityGateAdmission(
      { ...request, gateName: 'second' },
      cpuDeps(rootDir, () => clock, { slots: 2, samplePressure: secondSamplePressure }),
    )
    const thirdPromise = acquireQualityGateAdmission({ ...request, gateName: 'third' }, cpuDeps(rootDir, () => clock, { slots: 2 }))
    const secondSettled = settledFlag(secondPromise)
    const thirdSettled = settledFlag(thirdPromise)

    clock = 2_000
    const first = await driveUntilResolved(firstPromise)
    expect(first.cpuBypassed).toBe(true)

    const callsAtAdmission = secondSamplePressure.mock.calls.length
    await drive(() => secondSamplePressure.mock.calls.length >= callsAtAdmission + 3)
    expect(secondSettled()).toBe(false)
    expect(thirdSettled()).toBe(false)
    expect(existsSync(join(rootDir, 'slot-1.json'))).toBe(false)

    await first.release()
    const second = await driveUntilResolved(secondPromise)
    expect(second.cpuBypassed).toBe(true)
    expect(thirdSettled()).toBe(false)
    expect(readdirSync(rootDir).filter((entry) => entry === 'owner.json' || /^slot-\d+\.json$/.test(entry))).toEqual(['owner.json'])

    await second.release()
    const third = await driveUntilResolved(thirdPromise)
    expect(third.cpuBypassed).toBe(true)
    await third.release()
  })

  it('an unpressured admission clears the marker, so a later episode waits the full bound (PAN-5588)', async () => {
    const rootDir = home()
    writeFileSync(join(rootDir, QUEUE_CPU_MARKER_FILE), JSON.stringify({ since: 1 }))
    const samplePressure = vi.fn(async () => low)
    const handle = await driveUntilResolved(acquireQualityGateAdmission(request, cpuDeps(rootDir, () => 5_000, { samplePressure })))
    expect(handle.cpuBypassed).toBe(false)
    expect(existsSync(join(rootDir, QUEUE_CPU_MARKER_FILE))).toBe(false)
    await handle.release()

    let clock = 10_000
    const highPressure = vi.fn(async () => high)
    const secondPromise = acquireQualityGateAdmission({ ...request, gateName: 'tsc' }, cpuDeps(rootDir, () => clock, { samplePressure: highPressure }))
    const secondSettled = settledFlag(secondPromise)
    await driveUntil(() => cpuBlockedSince(rootDir) === 10_000)

    clock = 10_900
    await drive(() => highPressure.mock.calls.length >= 5)
    expect(secondSettled()).toBe(false)

    clock = 11_100
    expect((await driveUntilResolved(secondPromise)).cpuBypassed).toBe(true)
    await (await secondPromise).release()
  })

  it('a stale marker plus an unpressured sample admits normally (PAN-5588)', async () => {
    const rootDir = home()
    writeFileSync(join(rootDir, QUEUE_CPU_MARKER_FILE), JSON.stringify({ since: 1 }))
    const samplePressure = vi.fn(async () => low)
    const handle = await driveUntilResolved(acquireQualityGateAdmission(request, cpuDeps(rootDir, () => 1_000_000, { samplePressure })))
    expect(handle.cpuBypassed).toBe(false)
    expect(samplePressure.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(existsSync(join(rootDir, QUEUE_CPU_MARKER_FILE))).toBe(false)
    await handle.release()
  })

  it('a gate that passes a memory-blocked head keeps the queue\'s CPU block (PAN-5588)', async () => {
    const GiB = 1024 ** 3
    const MiB = 1024 ** 2
    const rootDir = home()
    let clock = 1
    let pressured = true
    let available = 20 * GiB
    const samplePressure = vi.fn(async () => (pressured ? high : low))
    const readFootprintEstimate = async (key: string) => (key === 'big' ? 10 * GiB : 1 * GiB)
    const sharedDeps = (extra: Partial<QualityGateAdmissionDeps> = {}): QualityGateAdmissionDeps => ({
      ...deps(rootDir),
      now: () => clock,
      slots: 2,
      cpuBypassMs: 1_000,
      headBypassMs: 60_000,
      softReserveBytes: 4 * GiB,
      hardReserveBytes: 4 * GiB,
      samplePressure,
      readFootprintEstimate,
      sampleMemory: async () => ({ memAvailableBytes: available, memTotalBytes: 64 * GiB }),
      readTreeRssBytes: async () => 100 * MiB,
      ...extra,
    })

    const headPromise = acquireQualityGateAdmission(
      { workspacePath: '/tmp/big', gateName: 'big-head', attempt: 1, footprintKey: 'big' },
      sharedDeps(),
    )
    await driveUntil(() => cpuBlockedSince(rootDir) === 1)
    await driveUntil(() => markerSince(rootDir) === 1)

    // The head still fit at 20 GiB; dropping to 8 GiB now fails its 10 GiB estimate against the soft reserve.
    available = 8 * GiB
    await driveUntil(() => typeof ticketField(rootDir, 'big-head', 'memoryBlockedSince') === 'number')

    const smallPromise = acquireQualityGateAdmission(
      { workspacePath: '/tmp/small', gateName: 'small-pass', attempt: 1, footprintKey: 'small' },
      sharedDeps(),
    )
    pressured = false
    const small = await driveUntilResolved(smallPromise)
    expect(small.cpuBypassed).toBe(false)
    expect(markerSince(rootDir)).toBe(1)
    await small.release()

    pressured = true
    available = 20 * GiB
    clock = 2_000
    const head = await driveUntilResolved(headPromise)
    expect(head.cpuBypassed).toBe(true)
    await head.release()

    const thirdPromise = acquireQualityGateAdmission(
      { workspacePath: '/tmp/third', gateName: 'third', attempt: 1 },
      sharedDeps(),
    )
    const third = await driveUntilResolved(thirdPromise)
    expect(third.cpuBypassed).toBe(true)
    await third.release()
  })

  it('a gate that enqueues after the previous one released inherits the episode (PAN-5588)', async () => {
    const rootDir = home()
    let clock = 1
    const firstPromise = acquireQualityGateAdmission(request, cpuDeps(rootDir, () => clock, { slots: 1 }))
    await driveUntil(() => cpuBlockedSince(rootDir) === 1)

    clock = 2_000
    const first = await driveUntilResolved(firstPromise)
    expect(first.cpuBypassed).toBe(true)
    await first.release()
    expect(markerSince(rootDir)).toBe(1)

    const secondPromise = acquireQualityGateAdmission({ ...request, gateName: 'tsc' }, cpuDeps(rootDir, () => clock, { slots: 1 }))
    expect((await driveUntilResolved(secondPromise)).cpuBypassed).toBe(true)
    await (await secondPromise).release()
  })

  describe('settings from config', () => {
    beforeEach(() => {
      configMocks.loadGlobalConfigNoMigration.mockReset()
      configMocks.loadConfigNoMigration.mockReset()
    })

    it('reads the PSI start threshold and the bypass bound from the global config only', async () => {
      configMocks.loadGlobalConfigNoMigration.mockResolvedValue({
        config: { resources: { qualityGatePsiStartAvg10: 40, qualityGateCpuBypassMinutes: 3 } },
      })
      expect(await resolveQualityGateCpuSettings()).toEqual({ psiStartAvg10: 40, bypassMs: 180_000 })
      expect(configMocks.loadConfigNoMigration).not.toHaveBeenCalled()
    })

    it('falls back to 25 and 10 minutes when the config cannot be read', async () => {
      configMocks.loadGlobalConfigNoMigration.mockRejectedValue(new Error('unreadable'))
      expect(await resolveQualityGateCpuSettings()).toEqual({ psiStartAvg10: 25, bypassMs: 600_000 })
    })

    it('samples pressure against the configured threshold', async () => {
      configMocks.loadGlobalConfigNoMigration.mockResolvedValue({
        config: { resources: { qualityGatePsiStartAvg10: 40, qualityGateCpuBypassMinutes: 3 } },
      })
      const rootDir = home()
      const { psiStartAvg10: _psi, cpuBypassMs: _bypass, ...rest } = deps(rootDir)
      const samplePressure = vi.fn(async () => low)
      const handle = await driveUntilResolved(acquireQualityGateAdmission(request, { ...rest, samplePressure }))
      expect(samplePressure).toHaveBeenCalledWith(40)
      await handle.release()
    })
  })
})

describe('readQualityGateQueue (PAN-5283)', () => {
  function waiterJson(ticketId: string, pid: number, createdAt: number, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({ ticketId, pid, createdAt, workspacePath: `/ws/${ticketId}`, gateName: 'vitest', attempt: 1, ...extra })
  }

  it('readQualityGateQueue lists live waiters oldest first', async () => {
    const rootDir = home()
    writeFileSync(join(rootDir, 'waiter-b.json'), waiterJson('b', process.pid, 200, { issueId: 'PAN-2', footprintBytes: 1024 }))
    writeFileSync(join(rootDir, 'waiter-a.json'), waiterJson('a', process.pid, 100))
    writeFileSync(join(rootDir, 'waiter-c.json'), waiterJson('c', process.pid, 150))
    writeFileSync(join(rootDir, 'owner.json'), ownerJson(process.pid, 50))
    const snapshot = await readQualityGateQueue({ rootDir, slots: 2, isProcessAlive: (pid) => pid === process.pid, now: () => 60, staleMs: 1_000 })
    expect(snapshot.slots).toBe(2)
    expect(snapshot.owners).toEqual([{
      workspacePath: '/tmp/owner', gateName: 'test', createdAt: 50, acquiredAt: 50, ticketId: `owner-${process.pid}`,
    }])
    expect(snapshot.waiters.map((waiter) => waiter.workspacePath)).toEqual(['/ws/a', '/ws/c', '/ws/b'])
    expect(snapshot.waiters[2]).toMatchObject({ issueId: 'PAN-2', footprintBytes: 1024, createdAt: 200 })
  })

  it('readQualityGateQueue skips dead pids without deleting their files', async () => {
    const rootDir = home()
    writeFileSync(join(rootDir, 'waiter-dead.json'), waiterJson('dead', 999_999, 100))
    writeFileSync(join(rootDir, 'owner.json'), ownerJson(999_999, 50))
    writeFileSync(join(rootDir, 'waiter-torn.json'), '{not json')
    const snapshot = await readQualityGateQueue({ rootDir, slots: 1, isProcessAlive: (pid) => pid === process.pid, now: () => 60 })
    expect(snapshot).toEqual({ slots: 1, owners: [], waiters: [] })
    expect(readdirSync(rootDir).sort()).toEqual(['owner.json', 'waiter-dead.json', 'waiter-torn.json'])
  })

  it('readQualityGateQueue returns an empty snapshot when the root is missing', async () => {
    const rootDir = join(home(), 'missing')
    expect(await readQualityGateQueue({ rootDir, slots: 3 })).toEqual({ slots: 3, owners: [], waiters: [] })
    expect(existsSync(rootDir)).toBe(false)
  })

  it('carries ticketId, footprintKey and memoryBlockedSince for a waiter (PAN-5621)', async () => {
    const rootDir = home()
    writeFileSync(join(rootDir, 'waiter-m.json'), waiterJson('m', process.pid, 100, {
      footprintKey: 'gate:typecheck:npm run typecheck', memoryBlockedSince: 1234,
    }))
    const snapshot = await readQualityGateQueue({ rootDir, slots: 1, isProcessAlive: (pid) => pid === process.pid })
    expect(snapshot.waiters).toEqual([{
      workspacePath: '/ws/m', gateName: 'vitest', createdAt: 100,
      ticketId: 'm', footprintKey: 'gate:typecheck:npm run typecheck', memoryBlockedSince: 1234,
    }])
  })

  it('reports readError for a root that is a regular file, with no readError on a missing root', async () => {
    const filePath = join(home(), 'not-a-dir')
    writeFileSync(filePath, 'x')
    const broken = await readQualityGateQueue({ rootDir: filePath, slots: 2 })
    expect(broken.owners).toEqual([])
    expect(broken.waiters).toEqual([])
    expect(typeof broken.readError).toBe('string')

    const missing = join(home(), 'missing')
    expect(await readQualityGateQueue({ rootDir: missing, slots: 2 })).toEqual({ slots: 2, owners: [], waiters: [] })
  })
})

describe('quality-gate last-admitted marker (PAN-5621)', () => {
  it('writes last-admitted.json on admission and readQualityGateQueue reports it', async () => {
    const rootDir = home()
    const handle = await driveUntilResolved(acquireQualityGateAdmission(
      { workspacePath: '/tmp/one', gateName: 'test', attempt: 1 },
      { ...deps(rootDir), now: () => 1 },
    ))
    const marker = JSON.parse(readFileSync(join(rootDir, 'last-admitted.json'), 'utf8')) as { at: number }
    expect(marker.at).toBe(Date.parse(handle.admittedAt))
    const snapshot = await readQualityGateQueue({ rootDir, slots: 1, isProcessAlive: (pid) => pid === process.pid })
    expect(snapshot.lastAdmittedAt).toBe(marker.at)
    await handle.release()
  })

  it('still admits when last-admitted.json is pre-created as a directory', async () => {
    const rootDir = home()
    mkdirSync(join(rootDir, 'last-admitted.json'))
    const handle = await driveUntilResolved(acquireQualityGateAdmission(
      { workspacePath: '/tmp/one', gateName: 'test', attempt: 1 },
      { ...deps(rootDir), now: () => 1 },
    ))
    expect(handle.slot).toBe(0)
    await handle.release()
  })
})

describe('sampleQualityGatePressure (PAN-4311)', () => {
  // Identical counters before and after the (skipped) 250 ms wait: 0% utilization.
  const idleCpus = Array.from({ length: 4 }, () => ({
    model: 'cpu', speed: 1, times: { user: 100, nice: 0, sys: 100, idle: 800, irq: 0 },
  }))
  const noWait = async () => undefined

  // PAN-5589: the before and after counters give `busy` utilization over the sample window.
  function cpusAt(busy: number) {
    const at = (user: number, idle: number) => Array.from({ length: 4 }, () => ({
      model: 'cpu', speed: 1, times: { user, nice: 0, sys: 0, idle, irq: 0 },
    }))
    osMocks.cpus.mockReturnValueOnce(at(0, 0)).mockReturnValueOnce(at(busy * 100, 100 - busy * 100))
  }

  beforeEach(() => {
    osMocks.cpus.mockReturnValue(idleCpus)
  })

  afterEach(async () => {
    const actual = await vi.importActual<typeof import('node:os')>('node:os')
    osMocks.cpus.mockImplementation(actual.cpus)
    osMocks.loadavg.mockImplementation(actual.loadavg)
  })

  it('is pressured when PSI some avg10 reaches 25 at 60 % utilization', async () => {
    cpusAt(0.6)
    osMocks.loadavg.mockReturnValue([0.4, 0, 0])
    const sample = await sampleQualityGatePressure(noWait, async () => ({ someAvg10: 30, someAvg60: 10 }))

    expect(sample).toMatchObject({ loadPerCore: 0.1, psiSomeAvg10: 30, pressured: true })
    expect(sample.cpuUtilization).toBeCloseTo(0.6)
  })

  it('honors a configured PSI start threshold (PAN-5520)', async () => {
    osMocks.loadavg.mockReturnValue([0.4, 0, 0])
    const psi = async () => ({ someAvg10: 30, someAvg60: 10 })

    cpusAt(0.6)
    expect(await sampleQualityGatePressure(noWait, psi, 35)).toMatchObject({ psiSomeAvg10: 30, pressured: false })
    cpusAt(0.6)
    expect(await sampleQualityGatePressure(noWait, psi, 30)).toMatchObject({ psiSomeAvg10: 30, pressured: true })
  })

  it('lets PSI win over a high load per core', async () => {
    osMocks.loadavg.mockReturnValue([12, 0, 0])
    const sample = await sampleQualityGatePressure(noWait, async () => ({ someAvg10: 10, someAvg60: 10 }))

    expect(sample).toMatchObject({ loadPerCore: 3, psiSomeAvg10: 10, pressured: false })
  })

  it('falls back to load per core when PSI is unavailable, at 60 % utilization', async () => {
    cpusAt(0.6)
    osMocks.loadavg.mockReturnValue([4.8, 0, 0])
    const sample = await sampleQualityGatePressure(noWait, async () => ({ someAvg10: null, someAvg60: null }))

    expect(sample).toMatchObject({ loadPerCore: 1.2, psiSomeAvg10: null, pressured: true })
  })

  it('ignores PSI from pinned workloads while utilization is below 50 % (PAN-5589)', async () => {
    cpusAt(0.44)
    osMocks.loadavg.mockReturnValue([0.4, 0, 0])
    const sample = await sampleQualityGatePressure(noWait, async () => ({ someAvg10: 35, someAvg60: 30 }))

    expect(sample).toMatchObject({ pressured: false })
  })

  it('counts PSI as contention from 50 % utilization (PAN-5589)', async () => {
    cpusAt(0.6)
    osMocks.loadavg.mockReturnValue([0.4, 0, 0])
    const sample = await sampleQualityGatePressure(noWait, async () => ({ someAvg10: 35, someAvg60: 30 }))

    expect(sample).toMatchObject({ pressured: true })
  })

  it('is pressured at 80 % utilization whatever PSI says (PAN-5589)', async () => {
    cpusAt(0.8)
    osMocks.loadavg.mockReturnValue([0.4, 0, 0])
    const sample = await sampleQualityGatePressure(noWait, async () => ({ someAvg10: 5, someAvg60: 5 }))

    expect(sample).toMatchObject({ pressured: true })
  })

  it('ignores high load per core below 50 % utilization without PSI (PAN-5589)', async () => {
    cpusAt(0.44)
    osMocks.loadavg.mockReturnValue([4.8, 0, 0])
    const sample = await sampleQualityGatePressure(noWait, async () => ({ someAvg10: null, someAvg60: null }))

    expect(sample).toMatchObject({ pressured: false })
  })
})
