import { link, mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { cpus, loadavg } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { getOverdeckHome } from '../paths.js'
import { readCpuPsi, type CpuPsi } from '../system-health/cpu-psi.js'

/**
 * Machine-wide CPU admission for quality gates and direct Vitest runs.
 * Admitted parents set OVERDECK_GATE_ADMITTED=1 for child-process reentrancy.
 */

const QUALITY_GATE_CPU_START_THRESHOLD = 0.75
const QUALITY_GATE_LOAD_PER_CORE_START_THRESHOLD = 1
/**
 * PAN-4311 D10: with CPU PSI available, start heavy runs only once `some avg10`
 * is below the governor's default recovery level. Load per core counts IO
 * wait, so it is the fallback only when PSI is unavailable.
 */
const QUALITY_GATE_PSI_SOME_AVG10_START_THRESHOLD = 25
const QUALITY_GATE_ADMISSION_POLL_MS = 1_000
const QUALITY_GATE_ADMISSION_SETTLE_MS = 1_500
const QUALITY_GATE_ADMISSION_STALE_MS = 25 * 60 * 1_000
/**
 * PAN-4610 D14: an unparseable ticket younger than this may still be mid-write
 * by an old-version process, so pollers leave it alone until it ages out.
 */
const QUALITY_GATE_ADMISSION_TORN_GRACE_MS = 10_000

export interface QualityGatePressureSample {
  cpuUtilization: number
  loadPerCore: number
  /** CPU PSI `some avg10`, percent; null when unavailable (PAN-4311). */
  psiSomeAvg10: number | null
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
  tornGraceMs?: number
  maxWaitMs?: number
}

export class QualityGateAdmissionTimeoutError extends Error {
  constructor(readonly maxWaitMs: number) {
    super(`quality-gate CPU admission timed out after ${maxWaitMs}ms`)
    this.name = 'QualityGateAdmissionTimeoutError'
  }
}

let ticketSequence = 0
let tempSequence = 0

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
  readPsi: () => Promise<CpuPsi> = readCpuPsi,
): Promise<QualityGatePressureSample> {
  const before = cpuTotals()
  await sleep(250)
  const after = cpuTotals()
  const totalDelta = after.total - before.total
  const idleDelta = after.idle - before.idle
  const cpuUtilization = totalDelta > 0 ? (totalDelta - idleDelta) / totalDelta : 0
  const loadPerCore = loadavg()[0] / after.cores
  const psiSomeAvg10 = (await readPsi()).someAvg10
  const contended = psiSomeAvg10 != null
    ? psiSomeAvg10 >= QUALITY_GATE_PSI_SOME_AVG10_START_THRESHOLD
    : loadPerCore >= QUALITY_GATE_LOAD_PER_CORE_START_THRESHOLD
  return {
    cpuUtilization,
    loadPerCore,
    psiSomeAvg10,
    pressured: cpuUtilization >= QUALITY_GATE_CPU_START_THRESHOLD || contended,
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

/**
 * Publish `value` at `path` atomically; throws EEXIST when `path` exists (PAN-4610).
 * Hard link rather than rename: a rename would replace an existing owner or
 * breaker file and break the exclusion every caller relies on (D13).
 */
async function publishExclusive(path: string, value: unknown): Promise<void> {
  const temp = join(dirname(path), `.tmp-${process.pid}-${tempSequence++}-${basename(path)}`)
  const file = await open(temp, 'wx', 0o600)
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
  } finally {
    await file.close()
  }
  try {
    await link(temp, path)
  } finally {
    await unlinkIfExists(temp)
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
      await publishExclusive(path, { pid: process.pid, acquiredAt: now() })
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

/** Milliseconds since `path` was last modified, or null when it no longer exists. */
async function fileAgeMs(path: string): Promise<number | null> {
  try {
    // Wall clock on purpose: mtime is wall-clock, and fake timers fake Date too.
    return Date.now() - (await stat(path)).mtimeMs
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return null
    throw error
  }
}

async function listLiveTickets(
  root: string,
  isProcessAlive: (pid: number) => boolean,
  tornGraceMs: number,
): Promise<AdmissionTicket[]> {
  const entries = await readdir(root)
  const tickets: AdmissionTicket[] = []
  for (const entry of entries) {
    const tempPid = /^\.tmp-(\d+)-/.exec(entry)?.[1]
    if (tempPid) {
      // D16: a process killed between write and link leaks its temp file.
      if (!isProcessAlive(Number(tempPid))) await unlinkIfExists(join(root, entry))
      continue
    }
    if (!entry.startsWith('waiter-') || !entry.endsWith('.json')) continue
    const path = join(root, entry)
    const ticket = await readJson<AdmissionTicket>(path)
    if (!ticket || typeof ticket.ticketId !== 'string' || !Number.isFinite(ticket.createdAt)) {
      const ageMs = await fileAgeMs(path)
      if (ageMs != null && ageMs > tornGraceMs) await unlinkIfExists(path)
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
  const tornGraceMs = deps.tornGraceMs ?? QUALITY_GATE_ADMISSION_TORN_GRACE_MS
  const maxWaitMs = deps.maxWaitMs

  await mkdir(root, { recursive: true })
  const createdAt = now()
  const ticketId = `${String(createdAt).padStart(16, '0')}-${String(pid).padStart(10, '0')}-${String(ticketSequence++).padStart(6, '0')}`
  const ticket: AdmissionTicket = { ...request, ticketId, pid, createdAt }
  const ownTicketPath = ticketPath(root, ticketId)
  await publishExclusive(ownTicketPath, ticket)

  try {
    for (;;) {
      if (maxWaitMs != null && now() - createdAt > maxWaitMs) {
        throw new QualityGateAdmissionTimeoutError(maxWaitMs)
      }
      const waiters = await listLiveTickets(root, isProcessAlive, tornGraceMs)
      if (!waiters.some((waiter) => waiter.ticketId === ticketId)) {
        // D15: another poller deleted our ticket; republish it to keep our FIFO place.
        try {
          await publishExclusive(ownTicketPath, ticket)
        } catch (error) {
          if (!isErrnoException(error) || error.code !== 'EEXIST') throw error
        }
        await sleep(pollMs)
        continue
      }
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
        await publishExclusive(ownerPath(root), owner)
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
