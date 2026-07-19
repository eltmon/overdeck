import { mkdir, open, readFile, readdir, unlink } from 'node:fs/promises'
import { cpus, loadavg } from 'node:os'
import { join } from 'node:path'

import { getOverdeckHome } from '../paths.js'

export const QUALITY_GATE_CPU_START_THRESHOLD = 0.75
export const QUALITY_GATE_LOAD_PER_CORE_START_THRESHOLD = 1
export const QUALITY_GATE_ADMISSION_POLL_MS = 1_000
export const QUALITY_GATE_ADMISSION_SETTLE_MS = 1_500
export const QUALITY_GATE_ADMISSION_STALE_MS = 25 * 60 * 1_000

export interface QualityGatePressureSample {
  cpuUtilization: number
  loadPerCore: number
  pressured: boolean
}

export interface QualityGateAdmissionRequest {
  issueId?: string
  workspacePath: string
  gateName: string
  attempt: number
}

export interface QualityGateAdmissionHandle {
  admittedAt: string
  release(): Promise<void>
}

interface AdmissionTicket extends QualityGateAdmissionRequest {
  ticketId: string
  pid: number
  createdAt: number
}

interface AdmissionOwner extends AdmissionTicket {
  acquiredAt: number
}

interface AdmissionBreaker {
  pid: number
  acquiredAt: number
}

export interface QualityGateAdmissionDeps {
  rootDir?: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  pid?: number
  isProcessAlive?: (pid: number) => boolean
  samplePressure?: () => Promise<QualityGatePressureSample>
  pollMs?: number
  settleMs?: number
  staleMs?: number
}

let ticketSequence = 0

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isErrnoException(error) && error.code === 'EPERM'
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cpuTotals() {
  const records = cpus()
  let idle = 0
  let total = 0
  for (const cpu of records) {
    idle += cpu.times.idle
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0)
  }
  return { idle, total, cores: Math.max(1, records.length) }
}

export async function sampleQualityGatePressure(
  sleep: (ms: number) => Promise<void> = delay,
): Promise<QualityGatePressureSample> {
  const before = cpuTotals()
  await sleep(250)
  const after = cpuTotals()
  const totalDelta = after.total - before.total
  const idleDelta = after.idle - before.idle
  const cpuUtilization = totalDelta > 0 ? (totalDelta - idleDelta) / totalDelta : 0
  const loadPerCore = loadavg()[0] / after.cores
  return {
    cpuUtilization,
    loadPerCore,
    pressured: cpuUtilization >= QUALITY_GATE_CPU_START_THRESHOLD
      || loadPerCore >= QUALITY_GATE_LOAD_PER_CORE_START_THRESHOLD,
  }
}

function admissionRoot(rootDir?: string): string {
  return rootDir ?? join(getOverdeckHome(), 'verification-workers', 'admission')
}

function ownerPath(root: string): string {
  return join(root, 'owner.json')
}

function breakerPath(root: string): string {
  return join(root, 'owner.break')
}

function ticketPath(root: string, ticketId: string): string {
  return join(root, `waiter-${ticketId}.json`)
}

async function writeExclusive(path: string, value: unknown): Promise<void> {
  const file = await open(path, 'wx', 0o600)
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
  } finally {
    await file.close()
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') throw error
  }
}

function sameOwner(left: AdmissionOwner | null, right: AdmissionOwner): boolean {
  return left?.ticketId === right.ticketId
    && left.pid === right.pid
    && left.acquiredAt === right.acquiredAt
}

function ownerIsStale(
  owner: AdmissionOwner,
  now: number,
  staleMs: number,
  isProcessAlive: (pid: number) => boolean,
): boolean {
  return now - owner.acquiredAt > staleMs || !isProcessAlive(owner.pid)
}

async function acquireBreaker(
  root: string,
  now: () => number,
  staleMs: number,
  isProcessAlive: (pid: number) => boolean,
): Promise<boolean> {
  const path = breakerPath(root)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeExclusive(path, { pid: process.pid, acquiredAt: now() })
      return true
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'EEXIST') throw error
      const existing = await readJson<AdmissionBreaker>(path)
      if (
        existing
        && now() - existing.acquiredAt <= staleMs
        && isProcessAlive(existing.pid)
      ) return false
      await unlinkIfExists(path)
    }
  }
  return false
}

async function clearStaleOwner(
  root: string,
  observed: AdmissionOwner | null,
  now: () => number,
  staleMs: number,
  isProcessAlive: (pid: number) => boolean,
): Promise<void> {
  if (!await acquireBreaker(root, now, staleMs, isProcessAlive)) return
  try {
    const current = await readJson<AdmissionOwner>(ownerPath(root))
    if (
      (!observed && !current)
      || (observed && sameOwner(current, observed)
        && ownerIsStale(observed, now(), staleMs, isProcessAlive))
    ) {
      await unlinkIfExists(ownerPath(root))
    }
  } finally {
    await unlinkIfExists(breakerPath(root))
  }
}

async function listLiveTickets(
  root: string,
  isProcessAlive: (pid: number) => boolean,
): Promise<AdmissionTicket[]> {
  const entries = await readdir(root)
  const tickets: AdmissionTicket[] = []
  for (const entry of entries) {
    if (!entry.startsWith('waiter-') || !entry.endsWith('.json')) continue
    const path = join(root, entry)
    const ticket = await readJson<AdmissionTicket>(path)
    if (!ticket || typeof ticket.ticketId !== 'string' || !Number.isFinite(ticket.createdAt)) {
      await unlinkIfExists(path)
      continue
    }
    if (!isProcessAlive(ticket.pid)) {
      await unlinkIfExists(path)
      continue
    }
    tickets.push(ticket)
  }
  return tickets.sort((left, right) => left.createdAt - right.createdAt
    || left.ticketId.localeCompare(right.ticketId))
}

export async function acquireQualityGateAdmission(
  request: QualityGateAdmissionRequest,
  deps: QualityGateAdmissionDeps = {},
): Promise<QualityGateAdmissionHandle> {
  const root = admissionRoot(deps.rootDir)
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? delay
  const pid = deps.pid ?? process.pid
  const isProcessAlive = deps.isProcessAlive ?? processIsAlive
  const samplePressure = deps.samplePressure ?? (() => sampleQualityGatePressure(sleep))
  const pollMs = deps.pollMs ?? QUALITY_GATE_ADMISSION_POLL_MS
  const settleMs = deps.settleMs ?? QUALITY_GATE_ADMISSION_SETTLE_MS
  const staleMs = deps.staleMs ?? QUALITY_GATE_ADMISSION_STALE_MS

  await mkdir(root, { recursive: true })
  const createdAt = now()
  const ticketId = `${String(createdAt).padStart(16, '0')}-${String(pid).padStart(10, '0')}-${String(ticketSequence++).padStart(6, '0')}`
  const ticket: AdmissionTicket = { ...request, ticketId, pid, createdAt }
  const ownTicketPath = ticketPath(root, ticketId)
  await writeExclusive(ownTicketPath, ticket)

  try {
    for (;;) {
      const waiters = await listLiveTickets(root, isProcessAlive)
      if (waiters[0]?.ticketId !== ticketId) {
        await sleep(pollMs)
        continue
      }

      const observedOwner = await readJson<AdmissionOwner>(ownerPath(root))
      if (observedOwner) {
        if (ownerIsStale(observedOwner, now(), staleMs, isProcessAlive)) {
          await clearStaleOwner(root, observedOwner, now, staleMs, isProcessAlive)
        }
        await sleep(pollMs)
        continue
      }

      const pressure = await samplePressure()
      if (pressure.pressured) {
        await sleep(pollMs)
        continue
      }

      const owner: AdmissionOwner = { ...ticket, acquiredAt: now() }
      try {
        await writeExclusive(ownerPath(root), owner)
      } catch (error) {
        if (isErrnoException(error) && error.code === 'EEXIST') {
          if (!await readJson<AdmissionOwner>(ownerPath(root))) {
            await clearStaleOwner(root, null, now, staleMs, isProcessAlive)
          }
          await sleep(pollMs)
          continue
        }
        throw error
      }

      await sleep(settleMs)
      const settledPressure = await samplePressure()
      if (settledPressure.pressured) {
        if (sameOwner(await readJson<AdmissionOwner>(ownerPath(root)), owner)) {
          await unlinkIfExists(ownerPath(root))
        }
        await sleep(pollMs)
        continue
      }

      await unlinkIfExists(ownTicketPath)
      let released = false
      return {
        admittedAt: new Date(owner.acquiredAt).toISOString(),
        async release() {
          if (released) return
          released = true
          if (sameOwner(await readJson<AdmissionOwner>(ownerPath(root)), owner)) {
            await unlinkIfExists(ownerPath(root))
          }
        },
      }
    }
  } catch (error) {
    await unlinkIfExists(ownTicketPath)
    throw error
  }
}
