import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as realSetImmediate } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  acquireQualityGateAdmission,
  type QualityGateAdmissionDeps,
  type QualityGatePressureSample,
} from '../../../../src/lib/cloister/quality-gate-admission.js'

const homes: string[] = []
const low: QualityGatePressureSample = { cpuUtilization: 0.2, loadPerCore: 0.2, pressured: false }
const high: QualityGatePressureSample = { cpuUtilization: 0.95, loadPerCore: 1.5, pressured: true }

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
    isProcessAlive: (pid) => pid === process.pid,
    samplePressure: vi.fn(async () => samples[Math.min(sampleIndex++, samples.length - 1)]!),
  }
}

async function driveUntilResolved<T>(promise: Promise<T>): Promise<T> {
  let settled = false
  promise.finally(() => { settled = true }).catch(() => undefined)
  for (let attempt = 0; attempt < 100 && !settled; attempt++) {
    await realSetImmediate()
    await vi.runOnlyPendingTimersAsync()
  }
  expect(settled).toBe(true)
  return promise
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
})
