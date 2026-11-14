import { link, mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises'
import { cpus, loadavg } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { getOverdeckHome } from '../paths.js'
import { readCpuPsi, type CpuPsi } from '../system-health/cpu-psi.js'
import { readProcessTreeRssBytes } from '../system-health/process-tree-rss.js'
import {
  evaluateMemoryHeadroom,
  ownerReservationBytes,
  readGateFootprintEstimate,
  recordGateFootprintPeak,
  resolveGateReserveBytes,
  type MemoryHeadroomVerdict,
} from './quality-gate-memory.js'

/**
 * Machine-wide CPU and memory admission for quality gates, direct Vitest runs
 * and tsc lanes. Admission has N slots (`resources.quality_gate_slots`,
 * default 2): slot 0 is `owner.json`, slot i >= 1 is `slot-<i>.json`. Waiters
 * queue FIFO, and every slot needs an unpressured sample before and after
 * settling, so a pressured sample blocks every new admission while running
 * gates keep their slots. A request with a `footprintKey` also waits while
 * MemAvailable minus the live owners' reservations and its own measured
 * footprint would fall below the governor's soft reserve (PAN-5248).
 *
 * PAN-5285: FIFO yields only to memory. A later waiter may pass when every
 * waiter ahead of it is blocked on memory, judged from their tickets with the
 * same reading, so the first waiter that fits goes and the others keep their
 * places. The head records in its ticket when it first failed the memory rule
 * as head. Once that block outlasts the bypass bound and the head could start
 * alone above the governor's hard reserve, nobody passes it: the slots drain
 * and the head is admitted alone. The estimate and the reserves are re-read on
 * every poll, and each waiter writes its current wait reason into its ticket
 * for status readers.
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
/**
 * PAN-5285: how long later waiters may pass a memory-blocked head, counted from
 * the head's first memory block as head. Well under the wrappers' 30-minute
 * wait, so the head is admitted alone before it times out.
 */
const QUALITY_GATE_HEAD_BYPASS_MS = 5 * 60 * 1_000
/**
 * PAN-5285: an older-version waiter froze its estimate and reserve at enqueue,
 * so it can look as if it fits today and still never start. One that has
 * "fitted" with a slot free for this long is treated as blocked on memory.
 */
const QUALITY_GATE_LEGACY_FIT_GRACE_MS = 30 * 1_000
/**
 * PAN-5285: tickets written by this version re-read their estimate per poll
 * and can be admitted alone. Older tickets froze their estimate at enqueue
 * and never start alone, so the bypass bound never applies to them.
 */
const ADMISSION_TICKET_VERSION = 2
/** PAN-5285: a changed wait reason is reported at most this often, so a flapping queue does not flood the log. */
const QUALITY_GATE_WAIT_REPORT_MS = 60 * 1_000
export const DEFAULT_QUALITY_GATE_SLOTS = 2

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
  /** PAN-5248: names the gate kind for memory estimation; omitted = no memory rule for this caller's own footprint. */
  footprintKey?: string
  /** PAN-5248 FR-12: reserve the whole footprint until release (container gates, whose memory is outside the host tree). */
  fullReservation?: boolean
}

/** Who a queued waiter is behind (PAN-5285). */
export interface QualityGateQueueBlocker {
  gateName: string
  issueId?: string
  workspacePath: string
}

export type QualityGateWaitReason =
  | {
    kind: 'queue'
    /** 0-based place in the queue. */
    position?: number
    /** The waiter ahead that this one may not pass. */
    blocker?: QualityGateQueueBlocker
    /** The blocker is the head and is due to be admitted alone (PAN-5285). */
    headAlone?: boolean
  }
  | { kind: 'slots' }
  | { kind: 'cpu'; sample: QualityGatePressureSample }
  | { kind: 'memory'; memAvailableBytes: number; reservationsBytes: number; footprintBytes: number; softReserveBytes: number }

export interface QualityGateMemorySample {
  memAvailableBytes: number
  memTotalBytes: number
}

export interface QualityGateAdmissionHandle {
  admittedAt: string
  /** 0-based slot this lease holds. */
  slot: number
  /** Slot count the lease was admitted under. */
  slots: number
  /** Footprint estimate the lease was admitted with; 0 without a `footprintKey`. */
  footprintBytes: number
  /** PAN-5285: admitted alone past the bypass bound, below the soft reserve but above the hard reserve. */
  admittedAlone: boolean
  /** Record the gate's peak RSS under its footprint key (D12); no-op without a key, never throws. */
  recordPeak(peakBytes: number): Promise<void>
  release(): Promise<void>
}

interface AdmissionTicket extends QualityGateAdmissionRequest {
  ticketId: string
  pid: number
  createdAt: number
  footprintBytes?: number
  /** PAN-5285: absent on tickets from older checkouts. */
  admissionVersion?: number
  /** PAN-5285: the waiter's current wait reason and when it began. */
  wait?: { since: number; reason: QualityGateWaitReason }
  /** PAN-5285: when this waiter, as head, first failed the memory rule; cleared once it fits. */
  memoryBlockedSince?: number
}

interface AdmissionOwner extends AdmissionTicket {
  acquiredAt: number
  /** Owner tree RSS just before publishing (FR-11). */
  rssBaselineBytes?: number
  /** PAN-5285: admitted alone past the bypass bound. */
  admittedAlone?: boolean
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
  slots?: number
  maxWaitMs?: number
  sampleMemory?: () => Promise<QualityGateMemorySample | null>
  readTreeRssBytes?: (pid: number) => Promise<number | null>
  softReserveBytes?: number
  /** PAN-5285: floor for a head admitted alone; defaults to `resources.governor_hard_reserve_gb`. */
  hardReserveBytes?: number
  /** PAN-5285: how long later waiters may pass a memory-blocked head. */
  headBypassMs?: number
  readFootprintEstimate?: (key: string) => Promise<number>
  onWaiting?: (reason: QualityGateWaitReason) => void
}

type MemoryWaitReason = Extract<QualityGateWaitReason, { kind: 'memory' }>
type QueueWaitReason = Extract<QualityGateWaitReason, { kind: 'queue' }>

export class QualityGateAdmissionTimeoutError extends Error {
  constructor(
    readonly maxWaitMs: number,
    /** FR-9: the kind of the last wait reason; 'memory' tells callers not to start the gate. */
    readonly lastWaitReason: QualityGateWaitReason['kind'] | null = null,
    readonly lastMemory?: MemoryWaitReason,
  ) {
    super(`quality-gate admission timed out after ${maxWaitMs}ms${lastWaitReason ? ` waiting on ${lastWaitReason}` : ''}`)
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

function slotOwnerPath(root: string, slot: number): string {
  return join(root, slot === 0 ? 'owner.json' : `slot-${slot}.json`)
}

function slotBreakerPath(root: string, slot: number): string {
  return join(root, slot === 0 ? 'owner.break' : `slot-${slot}.break`)
}

/** Canonical slot owner files only; aliases such as `slot-0.json` or `slot-01.json` are not slots (D6a). */
async function listSlotOwnerFiles(root: string): Promise<{ slot: number; path: string }[]> {
  const files: { slot: number; path: string }[] = []
  for (const entry of await readdir(root)) {
    if (entry === 'owner.json') {
      files.push({ slot: 0, path: join(root, entry) })
      continue
    }
    const slot = Number(/^slot-([1-9]\d*)\.json$/.exec(entry)?.[1])
    if (Number.isSafeInteger(slot)) files.push({ slot, path: join(root, entry) })
  }
  return files
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

/** PAN-5285: overwrite our own ticket atomically (temp file, then rename). */
async function replaceFile(path: string, value: unknown): Promise<void> {
  const temp = join(dirname(path), `.tmp-${process.pid}-${tempSequence++}-${basename(path)}`)
  try {
    const file = await open(temp, 'wx', 0o600)
    try {
      await file.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
    } finally {
      await file.close()
    }
    await rename(temp, path)
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
  slot: number,
  now: () => number,
  staleMs: number,
  isProcessAlive: (pid: number) => boolean,
): Promise<boolean> {
  const path = slotBreakerPath(root, slot)
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
  slot: number,
  observed: AdmissionOwner | null,
  now: () => number,
  staleMs: number,
  isProcessAlive: (pid: number) => boolean,
): Promise<void> {
  if (!await acquireBreaker(root, slot, now, staleMs, isProcessAlive)) return
  const path = slotOwnerPath(root, slot)
  try {
    const current = await readJson<AdmissionOwner>(path)
    if (
      (!observed && !current)
      || (observed && sameOwner(current, observed)
        && ownerIsStale(observed, now(), staleMs, isProcessAlive))
    ) {
      await unlinkIfExists(path)
    }
  } finally {
    await unlinkIfExists(slotBreakerPath(root, slot))
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

/**
 * Slot count from the global config only, so every workspace sharing the
 * machine-wide admission root sees the same limit (D5). Never throws: the
 * Vitest globalSetup runs without admission when acquire rejects.
 */
async function resolveQualityGateSlots(): Promise<number> {
  try {
    const { loadGlobalConfigNoMigration } = await import('../config-yaml/load.js')
    const slots = (await loadGlobalConfigNoMigration()).config.resources.qualityGateSlots
    return Number.isInteger(slots) && slots >= 1 ? slots : DEFAULT_QUALITY_GATE_SLOTS
  } catch {
    return DEFAULT_QUALITY_GATE_SLOTS
  }
}

async function sampleProcMemory(): Promise<QualityGateMemorySample | null> {
  const { readProcMemory } = await import('../../dashboard/server/services/proc-memory.js')
  const { memAvailable, memTotal } = await readProcMemory()
  return { memAvailableBytes: memAvailable, memTotalBytes: memTotal }
}

/** NFR-2: an unreadable or zero MemAvailable skips the memory rule. */
async function readMemory(
  sample: () => Promise<QualityGateMemorySample | null>,
): Promise<QualityGateMemorySample | null> {
  try {
    const memory = await sample()
    return memory && memory.memAvailableBytes > 0 ? memory : null
  } catch {
    return null
  }
}

/** Sum of the live owners' unallocated footprints (D4). */
async function sumReservations(
  owners: AdmissionOwner[],
  readTreeRssBytes: (pid: number) => Promise<number | null>,
): Promise<number> {
  let total = 0
  for (const owner of owners) {
    if (!owner.footprintBytes) continue
    const treeRss = owner.fullReservation || owner.rssBaselineBytes === undefined
      ? null
      : await readTreeRssBytes(owner.pid).catch(() => null)
    total += ownerReservationBytes(owner, treeRss)
  }
  return total
}

/** Pids of every live-file slot owner, for the runaway patrol (D9); never throws. */
export async function readQualityGateAdmissionOwnerPids(rootDir?: string): Promise<number[]> {
  try {
    const pids: number[] = []
    for (const { path } of await listSlotOwnerFiles(admissionRoot(rootDir))) {
      const pid = (await readJson<Partial<AdmissionOwner>>(path))?.pid
      if (typeof pid === 'number' && Number.isInteger(pid)) pids.push(pid)
    }
    return pids
  } catch {
    return []
  }
}

/** One running or queued gate, as the read-only queue snapshot reports it (PAN-5283 WI-2). */
export interface QualityGateQueueEntry {
  issueId?: string
  workspacePath: string
  gateName: string
  footprintBytes?: number
  createdAt: number
  /** Set on owners only. */
  acquiredAt?: number
  /** PAN-5285: set on waiters only; the reason the waiter last reported and when it began. */
  wait?: { since: number; reason: QualityGateWaitReason }
}

export interface QualityGateQueueSnapshot {
  slots: number
  owners: QualityGateQueueEntry[]
  waiters: QualityGateQueueEntry[]
}

function queueEntry(ticket: AdmissionTicket | AdmissionOwner): QualityGateQueueEntry {
  const entry: QualityGateQueueEntry = {
    workspacePath: ticket.workspacePath,
    gateName: ticket.gateName,
    createdAt: ticket.createdAt,
  }
  if (ticket.issueId) entry.issueId = ticket.issueId
  if (typeof ticket.footprintBytes === 'number') entry.footprintBytes = ticket.footprintBytes
  if ('acquiredAt' in ticket && Number.isFinite(ticket.acquiredAt)) entry.acquiredAt = ticket.acquiredAt
  if (ticket.wait && Number.isFinite(ticket.wait.since)) entry.wait = ticket.wait
  return entry
}

function isTicketShape(value: unknown): value is AdmissionTicket {
  const ticket = value as Partial<AdmissionTicket> | null
  return !!ticket
    && typeof ticket.workspacePath === 'string'
    && typeof ticket.gateName === 'string'
    && typeof ticket.pid === 'number'
    && Number.isFinite(ticket.createdAt)
}

/**
 * Read-only snapshot of the gate queue: live owners and live waiters, oldest
 * waiter first. Unlike the acquire loop it never unlinks or writes a file, so
 * the Flywheel page can read it on every poll. Never throws.
 */
export async function readQualityGateQueue(deps: {
  rootDir?: string
  isProcessAlive?: (pid: number) => boolean
  slots?: number
  now?: () => number
  staleMs?: number
} = {}): Promise<QualityGateQueueSnapshot> {
  const slots = deps.slots ?? await resolveQualityGateSlots()
  const empty: QualityGateQueueSnapshot = { slots, owners: [], waiters: [] }
  const isProcessAlive = deps.isProcessAlive ?? processIsAlive
  const now = deps.now ?? Date.now
  const staleMs = deps.staleMs ?? QUALITY_GATE_ADMISSION_STALE_MS
  const root = admissionRoot(deps.rootDir)
  try {
    const owners: QualityGateQueueEntry[] = []
    for (const { path } of await listSlotOwnerFiles(root)) {
      const owner = await readJson<AdmissionOwner>(path)
      if (!isTicketShape(owner) || !Number.isFinite(owner.acquiredAt)) continue
      if (ownerIsStale(owner, now(), staleMs, isProcessAlive)) continue
      owners.push(queueEntry(owner))
    }
    const waiters: AdmissionTicket[] = []
    for (const entry of await readdir(root)) {
      if (!entry.startsWith('waiter-') || !entry.endsWith('.json')) continue
      const ticket = await readJson<AdmissionTicket>(join(root, entry))
      if (!isTicketShape(ticket) || !isProcessAlive(ticket.pid)) continue
      waiters.push(ticket)
    }
    waiters.sort((left, right) => left.createdAt - right.createdAt
      || String(left.ticketId).localeCompare(String(right.ticketId)))
    return { slots, owners, waiters: waiters.map(queueEntry) }
  } catch {
    return empty
  }
}

/** The gate's own MemAvailable read; null when unreadable or zero. */
export async function readQualityGateMemory(): Promise<QualityGateMemorySample | null> {
  return readMemory(sampleProcMemory)
}

function queueBlocker(ticket: AdmissionTicket): QualityGateQueueBlocker {
  return {
    gateName: ticket.gateName,
    ...(ticket.issueId ? { issueId: ticket.issueId } : {}),
    workspacePath: ticket.workspacePath,
  }
}

/** Memory facts one poll shares between its own rule and its judgement of the waiters ahead. */
interface PollMemory {
  memory: QualityGateMemorySample
  reservationsBytes: number
  softReserveBytes: number
  hardReserveBytes: number
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
  const headBypassMs = deps.headBypassMs ?? QUALITY_GATE_HEAD_BYPASS_MS
  const slots = Number.isInteger(deps.slots) && deps.slots! >= 1 ? deps.slots! : await resolveQualityGateSlots()
  const maxWaitMs = deps.maxWaitMs
  const footprintKey = request.footprintKey
  const sampleMemory = deps.sampleMemory ?? sampleProcMemory
  const readTreeRssBytes = deps.readTreeRssBytes ?? ((treePid: number) => readProcessTreeRssBytes(treePid))
  const readFootprintEstimate = deps.readFootprintEstimate ?? ((key: string) => readGateFootprintEstimate(key, root))

  await mkdir(root, { recursive: true })
  const createdAt = now()
  const ticketId = `${String(createdAt).padStart(16, '0')}-${String(pid).padStart(10, '0')}-${String(ticketSequence++).padStart(6, '0')}`
  const ticket: AdmissionTicket = {
    ...request,
    ticketId,
    pid,
    createdAt,
    admissionVersion: ADMISSION_TICKET_VERSION,
    ...(footprintKey ? { footprintBytes: await readFootprintEstimate(footprintKey) } : {}),
  }
  const ownTicketPath = ticketPath(root, ticketId)

  /** PAN-5285: read per poll, like the estimate, so a lowered reserve reaches waiters already queued. */
  const resolveReserves = async (): Promise<{ soft: number; hard: number }> => {
    if (deps.softReserveBytes != null && deps.hardReserveBytes != null) {
      return { soft: deps.softReserveBytes, hard: deps.hardReserveBytes }
    }
    const resolved = await resolveGateReserveBytes()
    return { soft: deps.softReserveBytes ?? resolved.softBytes, hard: deps.hardReserveBytes ?? resolved.hardBytes }
  }

  /** The ticket on disk lags `ticket` until a write succeeds; the loop retries every poll. */
  let ticketDirty = false
  const persistTicket = async (): Promise<void> => {
    try {
      await replaceFile(ownTicketPath, ticket)
      ticketDirty = false
    } catch {
      ticketDirty = true
    }
  }
  /** Start or clear our memory-block clock (head polls only), writing it to the ticket for the waiters behind. */
  const setMemoryBlocked = async (blocked: boolean): Promise<void> => {
    const since = blocked ? ticket.memoryBlockedSince ?? now() : undefined
    if (since !== ticket.memoryBlockedSince) {
      ticket.memoryBlockedSince = since
      ticketDirty = true
    }
    if (ticketDirty) await persistTicket()
  }
  /** Older-version peers first seen "fitting" with a slot free, by ticket id (PAN-5285). */
  const legacyFitSince = new Map<string, number>()

  let reportedKey: string | null = null
  let reportedAt = 0
  let lastWaitKind: QualityGateWaitReason['kind'] | null = null
  let waitingSince = 0
  let lastMemory: MemoryWaitReason | undefined
  /**
   * Called on every blocked poll. Reports the reason the first time, then a
   * changed reason at most once per QUALITY_GATE_WAIT_REPORT_MS (PAN-5285), and
   * records each reported reason in our ticket for status readers.
   */
  const notifyWaiting = async (reason: QualityGateWaitReason): Promise<void> => {
    if (reason.kind === 'memory') lastMemory = reason
    if (reason.kind !== lastWaitKind) waitingSince = now()
    lastWaitKind = reason.kind
    const key = reason.kind === 'queue'
      ? `queue:${reason.blocker?.gateName}:${reason.blocker?.workspacePath}:${reason.headAlone === true}`
      : reason.kind
    if (key === reportedKey) return
    if (reportedKey !== null && now() - reportedAt < QUALITY_GATE_WAIT_REPORT_MS) return
    reportedKey = key
    reportedAt = now()
    ticket.wait = { since: waitingSince, reason }
    await persistTicket()
    try {
      deps.onWaiting?.(reason)
    } catch {
      // A listener must never break admission.
    }
  }

  const readPollMemory = async (owners: AdmissionOwner[]): Promise<PollMemory | null> => {
    const memory = await readMemory(sampleMemory)
    if (!memory) return null
    const { soft, hard } = await resolveReserves()
    return { memory, reservationsBytes: await sumReservations(owners, readTreeRssBytes), softReserveBytes: soft, hardReserveBytes: hard }
  }
  const verdictFor = (poll: PollMemory, estimateBytes: number): MemoryHeadroomVerdict => evaluateMemoryHeadroom({
    ...poll.memory,
    softReserveBytes: poll.softReserveBytes,
    estimateBytes,
    reservationsBytes: poll.reservationsBytes,
  })
  const memoryReason = (poll: PollMemory, verdict: MemoryHeadroomVerdict): MemoryWaitReason => ({
    kind: 'memory',
    memAvailableBytes: poll.memory.memAvailableBytes,
    reservationsBytes: poll.reservationsBytes,
    footprintBytes: verdict.footprintBytes,
    softReserveBytes: poll.softReserveBytes,
  })
  /** Alone, the gate would still leave the hard reserve free. */
  const fitsAlone = (poll: PollMemory, verdict: MemoryHeadroomVerdict): boolean =>
    poll.memory.memAvailableBytes - verdict.footprintBytes >= poll.hardReserveBytes
  /**
   * Why we must keep our place behind `ahead`, or null when we may pass all of
   * them: each is blocked on memory and the head is not due to run alone. A
   * head whose memory block has outlasted the bound is due while any slot is
   * held (draining the slots is what lets it start) or while it would fit
   * alone right now. Called only while a slot is free.
   */
  const queueBlock = async (
    ahead: AdmissionTicket[],
    poll: PollMemory | null,
    slotsHeld: boolean,
  ): Promise<QueueWaitReason | null> => {
    const position = ahead.length
    const keepPlace = (blocker: AdmissionTicket, headAlone = false): QueueWaitReason => ({
      kind: 'queue',
      position,
      blocker: queueBlocker(blocker),
      ...(headAlone ? { headAlone } : {}),
    })
    if (!poll) return keepPlace(ahead[0]!)
    for (const [index, peer] of ahead.entries()) {
      if (!peer.footprintKey) return keepPlace(peer)
      // Older tickets are judged by the estimate they froze at enqueue, as they judge themselves.
      const estimate = peer.admissionVersion ? await readFootprintEstimate(peer.footprintKey) : peer.footprintBytes ?? 0
      const verdict = verdictFor(poll, estimate)
      if (verdict.ok) {
        if (peer.admissionVersion) return keepPlace(peer)
        // An older peer that fits with a slot free would have started; past the grace, it is stuck on its frozen numbers.
        const since = legacyFitSince.get(peer.ticketId) ?? now()
        legacyFitSince.set(peer.ticketId, since)
        if (now() - since <= QUALITY_GATE_LEGACY_FIT_GRACE_MS) return keepPlace(peer)
        continue
      }
      legacyFitSince.delete(peer.ticketId)
      const blockedSince = peer.memoryBlockedSince
      if (index === 0 && peer.admissionVersion && blockedSince != null && now() - blockedSince > headBypassMs
        && (slotsHeld || fitsAlone(poll, verdict))) {
        return keepPlace(peer, true)
      }
    }
    return null
  }

  await publishExclusive(ownTicketPath, ticket)

  try {
    for (;;) {
      if (maxWaitMs != null && now() - createdAt > maxWaitMs) {
        throw new QualityGateAdmissionTimeoutError(maxWaitMs, lastWaitKind, lastWaitKind === 'memory' ? lastMemory : undefined)
      }
      const waiters = await listLiveTickets(root, isProcessAlive, tornGraceMs)
      const position = waiters.findIndex((waiter) => waiter.ticketId === ticketId)
      if (position < 0) {
        // D15: another poller deleted our ticket; republish it to keep our FIFO place.
        try {
          await publishExclusive(ownTicketPath, ticket)
        } catch (error) {
          if (!isErrnoException(error) || error.code !== 'EEXIST') throw error
        }
        await sleep(pollMs)
        continue
      }

      let reclaimed = false
      const taken = new Set<number>()
      const liveOwners: AdmissionOwner[] = []
      for (const { slot, path } of await listSlotOwnerFiles(root)) {
        const observed = await readJson<AdmissionOwner>(path)
        if (observed) {
          if (ownerIsStale(observed, now(), staleMs, isProcessAlive)) {
            await clearStaleOwner(root, slot, observed, now, staleMs, isProcessAlive)
            reclaimed = true
          } else {
            taken.add(slot)
            liveOwners.push(observed)
          }
          continue
        }
        // D14: a torn slot file may be an old-version process mid-write; it holds
        // the slot until it outlives the torn grace, then it is cleared.
        const ageMs = await fileAgeMs(path)
        if (ageMs == null) continue
        if (ageMs > tornGraceMs) {
          await clearStaleOwner(root, slot, null, now, staleMs, isProcessAlive)
          reclaimed = true
        } else {
          taken.add(slot)
        }
      }
      // `taken` counts every slot file, so a held slot above a lowered N still counts (D3).
      if (reclaimed || taken.size >= slots) {
        if (taken.size >= slots) {
          await notifyWaiting(position === 0 ? { kind: 'slots' } : { kind: 'queue', position, blocker: queueBlocker(waiters[0]!) })
        }
        await sleep(pollMs)
        continue
      }

      // PAN-5285: re-read the estimate every poll, so a corrected footprint file unblocks a queued waiter.
      if (footprintKey) ticket.footprintBytes = await readFootprintEstimate(footprintKey)
      const poll = footprintKey || position > 0 ? await readPollMemory(liveOwners) : null
      const ownVerdict = footprintKey && poll ? verdictFor(poll, ticket.footprintBytes!) : null
      let alone = false
      if (position > 0) {
        const queued = await queueBlock(waiters.slice(0, position), poll, taken.size > 0)
        if (queued) {
          await notifyWaiting(queued)
          await sleep(pollMs)
          continue
        }
      }
      if (position === 0 && ownVerdict) await setMemoryBlocked(!ownVerdict.ok)
      if (ownVerdict && !ownVerdict.ok) {
        // PAN-5285: a head blocked on memory for longer than the bypass bound starts alone
        // once the slots are empty, as long as it would leave the hard reserve free.
        const blockedSince = ticket.memoryBlockedSince
        alone = position === 0 && taken.size === 0 && blockedSince != null && now() - blockedSince > headBypassMs
          && fitsAlone(poll!, ownVerdict)
        if (!alone) {
          await notifyWaiting(memoryReason(poll!, ownVerdict))
          await sleep(pollMs)
          continue
        }
      }

      const pressure = await samplePressure()
      if (pressure.pressured) {
        await notifyWaiting({ kind: 'cpu', sample: pressure })
        await sleep(pollMs)
        continue
      }

      // taken.size < slots guarantees a free index below `slots`.
      let slot = 0
      while (taken.has(slot)) slot++
      const path = slotOwnerPath(root, slot)
      const baseline = footprintKey ? await readTreeRssBytes(pid).catch(() => null) : null
      const owner: AdmissionOwner = {
        ...ticket,
        wait: undefined,
        memoryBlockedSince: undefined,
        acquiredAt: now(),
        ...(baseline != null ? { rssBaselineBytes: baseline } : {}),
        ...(alone ? { admittedAlone: true } : {}),
      }
      try {
        await publishExclusive(path, owner)
      } catch (error) {
        if (isErrnoException(error) && error.code === 'EEXIST') {
          if (!await readJson<AdmissionOwner>(path)) {
            await clearStaleOwner(root, slot, null, now, staleMs, isProcessAlive)
          }
          await sleep(pollMs)
          continue
        }
        throw error
      }

      await sleep(settleMs)
      const settledPressure = await samplePressure()
      if (settledPressure.pressured) {
        await notifyWaiting({ kind: 'cpu', sample: settledPressure })
        if (sameOwner(await readJson<AdmissionOwner>(path), owner)) {
          await unlinkIfExists(path)
        }
        await sleep(pollMs)
        continue
      }

      if (footprintKey) {
        // FR-10: re-check memory against the other live owners after settling.
        const others: AdmissionOwner[] = []
        for (const { path: otherPath } of await listSlotOwnerFiles(root)) {
          const other = await readJson<AdmissionOwner>(otherPath)
          if (other && other.ticketId !== ticketId && !ownerIsStale(other, now(), staleMs, isProcessAlive)) others.push(other)
        }
        // PAN-5285: a head admitted alone skips the soft-reserve re-check, which it
        // already failed, but gives the slot back if another gate joined it.
        const settledPoll = alone ? null : await readPollMemory(others)
        const settledVerdict = settledPoll ? verdictFor(settledPoll, owner.footprintBytes ?? 0) : null
        if ((alone && others.length > 0) || (settledVerdict && !settledVerdict.ok)) {
          if (settledPoll && settledVerdict) await notifyWaiting(memoryReason(settledPoll, settledVerdict))
          if (sameOwner(await readJson<AdmissionOwner>(path), owner)) await unlinkIfExists(path)
          await sleep(pollMs)
          continue
        }
      }

      await unlinkIfExists(ownTicketPath)
      let released = false
      return {
        admittedAt: new Date(owner.acquiredAt).toISOString(),
        slot,
        slots,
        footprintBytes: owner.footprintBytes ?? 0,
        admittedAlone: alone,
        async recordPeak(peakBytes: number) {
          if (!footprintKey) return
          try {
            await recordGateFootprintPeak(footprintKey, peakBytes, root)
          } catch {
            // D12: recording is best-effort.
          }
        },
        async release() {
          if (released) return
          released = true
          if (sameOwner(await readJson<AdmissionOwner>(path), owner)) {
            await unlinkIfExists(path)
          }
        },
      }
    }
  } catch (error) {
    await unlinkIfExists(ownTicketPath)
    throw error
  }
}
