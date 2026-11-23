import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { getOverdeckHome } from '../paths.js'
import { readJson, replaceFile, unlinkIfExists } from './quality-gate-admission-files.js'
import {
  readQualityGateMemory,
  readQualityGateQueue,
  type QualityGateMemorySample,
  type QualityGateQueueEntry,
  type QualityGateQueueSnapshot,
} from './quality-gate-admission.js'
import { fitsAloneAboveHardReserve } from './quality-gate-memory.js'

/**
 * PAN-5621: pure starvation predicate, durable episode record and status
 * line for a gate admission queue that cannot start any gate because
 * MemAvailable stays below the hard reserve plus the next gate's footprint.
 *
 * Kept free of memory-governor.ts, memory-pressure-patrol.ts,
 * flywheel/board.ts and any src/dashboard module (NFR-5): `pan status` loads
 * this module directly on every invocation.
 */

export const GATE_STARVATION_FILE = 'starvation.json'
export const DEFAULT_QUALITY_GATE_STARVATION_MINUTES = 15

export interface GateStarvationHolder {
  pid: number
  rssBytes: number
  comm: string
  sessionName: string | null
}

export interface GateStarvationRecord {
  version: 1
  /** ISO time the episode opened; also the stable id/tag stem. */
  since: string
  /** The same moment in ms, compared with the snapshot's lastAdmittedAt. */
  openedAtMs: number
  /** True once the opening warn entry settled. */
  announced: boolean
  /** Set when the episode closed and its recovery entry has not settled yet. */
  closing?: { at: string; reason: 'admitted' | 'emptied' }
  /** The current head; replaced on handover. */
  head: { ticketId: string; issueId?: string; gateName: string; workspacePath: string; createdAt: number }
  memAvailableBytes: number
  hardReserveBytes: number
  /** The current head's footprint clamped to memTotal - hard reserve; null when it has no footprintKey. */
  footprintBytes: number | null
  /** Captured once, at opening. */
  holders: GateStarvationHolder[]
}

export type GateStarvationVerdict =
  | { starved: false; reason: 'empty' | 'owner-running' | 'head-not-memory-blocked' | 'under-threshold' | 'memory-unreadable' | 'fits-alone' }
  | { starved: true; head: QualityGateQueueEntry; memAvailableBytes: number; footprintBytes: number }

export interface EvaluateGateStarvationInput {
  snapshot: QualityGateQueueSnapshot
  memory: QualityGateMemorySample | null
  hardReserveBytes: number
  /** Re-read from the footprint store by the caller; null when the head has no footprintKey. */
  headEstimateBytes: number | null
  starvationMs: number
  now: number
}

/** D3: pure starvation predicate. Reasons are checked in a fixed order so a test can target any one. */
export function evaluateGateStarvation(input: EvaluateGateStarvationInput): GateStarvationVerdict {
  const head = input.snapshot.waiters[0]
  if (!head) return { starved: false, reason: 'empty' }
  if (input.snapshot.owners.length > 0) return { starved: false, reason: 'owner-running' }
  if (!head.footprintKey || !head.ticketId || !Number.isFinite(head.memoryBlockedSince) || input.headEstimateBytes === null) {
    return { starved: false, reason: 'head-not-memory-blocked' }
  }
  if (input.now - head.memoryBlockedSince! < input.starvationMs) return { starved: false, reason: 'under-threshold' }
  if (!input.memory || input.memory.memAvailableBytes <= 0) return { starved: false, reason: 'memory-unreadable' }
  const verdict = fitsAloneAboveHardReserve({
    memAvailableBytes: input.memory.memAvailableBytes,
    memTotalBytes: input.memory.memTotalBytes,
    hardReserveBytes: input.hardReserveBytes,
    estimateBytes: input.headEstimateBytes,
  })
  if (verdict.ok) return { starved: false, reason: 'fits-alone' }
  return { starved: true, head, memAvailableBytes: input.memory.memAvailableBytes, footprintBytes: verdict.footprintBytes }
}

/** D4: null on an unreadable snapshot (never close or open anything on unknown state). */
export function starvationEpisodeCloseReason(snapshot: QualityGateQueueSnapshot, openedAtMs: number): 'admitted' | 'emptied' | null {
  if (snapshot.readError) return null
  if (snapshot.owners.length > 0 || (snapshot.lastAdmittedAt !== undefined && snapshot.lastAdmittedAt >= openedAtMs)) {
    return 'admitted'
  }
  if (snapshot.waiters.length === 0) return 'emptied'
  return null
}

export function gateAdmissionRoot(rootDir?: string): string {
  return rootDir ?? join(getOverdeckHome(), 'verification-workers', 'admission')
}

function isGateStarvationRecord(value: unknown): value is GateStarvationRecord {
  return !!value && typeof value === 'object' && (value as { version?: unknown }).version === 1
}

/** D6: null for a missing, torn or wrong-version file. */
export async function readGateStarvationRecord(rootDir?: string): Promise<GateStarvationRecord | null> {
  const record = await readJson<GateStarvationRecord>(join(gateAdmissionRoot(rootDir), GATE_STARVATION_FILE))
  return isGateStarvationRecord(record) ? record : null
}

export async function writeGateStarvationRecord(record: GateStarvationRecord, rootDir?: string): Promise<void> {
  const root = gateAdmissionRoot(rootDir)
  await mkdir(root, { recursive: true })
  await replaceFile(join(root, GATE_STARVATION_FILE), record)
}

export async function clearGateStarvationRecord(rootDir?: string): Promise<void> {
  await unlinkIfExists(join(gateAdmissionRoot(rootDir), GATE_STARVATION_FILE))
}

/** D11: never throws; the fallback is the 15-minute default. Read on every poll. */
export async function resolveQualityGateStarvationMs(): Promise<number> {
  try {
    const { loadGlobalConfigNoMigration } = await import('../config-yaml/load.js')
    const minutes = (await loadGlobalConfigNoMigration()).config.resources.qualityGateStarvationMinutes
    return Number.isFinite(minutes) && minutes > 0
      ? minutes * 60_000
      : DEFAULT_QUALITY_GATE_STARVATION_MINUTES * 60_000
  } catch {
    return DEFAULT_QUALITY_GATE_STARVATION_MINUTES * 60_000
  }
}

// ─── formatting (D9): private copies of board.ts's formatClock/formatWaitAge, so this module stays light (NFR-5) ───

function formatClock(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** `<1 min`, `<m> min`, or `<h> h <m> min`. */
function formatWaitAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return '<1 min'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

const STARVATION_GIB = 1024 ** 3

function formatGib(bytes: number): string {
  return (bytes / STARVATION_GIB).toFixed(1)
}

/** D9: one status/activity line for an open episode. */
export function formatGateStarvationLine(record: GateStarvationRecord, opts: { now: number; memAvailableBytes?: number }): string {
  const forIssue = record.head.issueId ? ` for ${record.head.issueId}` : ''
  const waited = formatWaitAge(opts.now - record.head.createdAt)
  const needs = record.footprintBytes !== null
    ? ` and needs ${formatGib(record.footprintBytes)} GiB above the ${formatGib(record.hardReserveBytes)} GiB hard reserve`
    : ''
  const available = opts.memAvailableBytes ?? record.memAvailableBytes
  const holders = record.holders.length > 0
    ? ` Top memory at opening: ${record.holders.map((holder) => (
        `${holder.comm} ${formatGib(holder.rssBytes)} GiB (pid ${holder.pid}${holder.sessionName ? `, ${holder.sessionName}` : ''})`
      )).join(', ')}.`
    : ''
  return `Gate queue starved since ${formatClock(record.since)} (${formatWaitAge(opts.now - record.openedAtMs)}): `
    + `${record.head.gateName}${forIssue} has waited ${waited}${needs}; ${formatGib(available)} GiB available.`
    + `${holders} Free memory to let it start.`
}

export interface GateStarvationStatusLineDeps {
  rootDir?: string
  readQueue?: () => Promise<QualityGateQueueSnapshot>
  readMemory?: () => Promise<QualityGateMemorySample | null>
  now?: () => number
}

/** D10: never throws; null unless an open, non-closing record exists and a fresh read confirms the episode is still open. */
export async function gateStarvationStatusLine(deps: GateStarvationStatusLineDeps = {}): Promise<string | null> {
  try {
    const record = await readGateStarvationRecord(deps.rootDir)
    if (!record || record.closing) return null
    const readQueue = deps.readQueue ?? (() => readQualityGateQueue({ rootDir: deps.rootDir }))
    const snapshot = await readQueue()
    if (snapshot.readError) return null
    if (starvationEpisodeCloseReason(snapshot, record.openedAtMs)) return null
    const readMemory = deps.readMemory ?? readQualityGateMemory
    const now = deps.now ?? Date.now
    const memory = await readMemory().catch(() => null)
    return formatGateStarvationLine(record, { now: now(), memAvailableBytes: memory?.memAvailableBytes })
  } catch {
    return null
  }
}
