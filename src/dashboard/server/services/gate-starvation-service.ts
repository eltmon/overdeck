/**
 * PAN-5621: primary-dashboard service that polls the gate admission queue
 * every 30s, opens a durable starvation episode when `evaluateGateStarvation`
 * says the head cannot start even alone, and announces/closes it through a
 * settled activity entry and a best-effort phone push. Mirrors
 * `disk-alert-service.ts`'s shape. Runs in the primary dashboard only
 * (main.ts): a peer would announce every episode twice and `pushNeedsYouEdge`
 * is a no-op there anyway.
 */

import { type ActivityEmitOutcome, emitActivityEntryOnce, type EmitActivityOptions } from '../../../lib/activity-logger.js';
import {
  clearGateStarvationRecord,
  evaluateGateStarvation,
  formatGateStarvationLine,
  gateAdmissionRoot,
  type GateStarvationHolder,
  type GateStarvationRecord,
  readGateStarvationRecord,
  resolveQualityGateStarvationMs,
  starvationEpisodeCloseReason,
  writeGateStarvationRecord,
} from '../../../lib/cloister/gate-starvation.js';
import { topMemoryConsumers } from '../../../lib/cloister/memory-pressure-patrol.js';
import {
  readQualityGateMemory,
  readQualityGateQueue,
  type QualityGateMemorySample,
  type QualityGateQueueSnapshot,
} from '../../../lib/cloister/quality-gate-admission.js';
import { fitsAloneAboveHardReserve, readGateFootprintEstimate, resolveGateReserveBytes } from '../../../lib/cloister/quality-gate-memory.js';
import type { EdgeNotification } from '../../../lib/push/classify.js';
import { getRuntimeCensus } from '../../../lib/runtime-census.js';
import { pushNeedsYouEdge } from './needs-you-push-service.js';

export const GATE_STARVATION_POLL_MS = 30_000;

export interface GateStarvationServiceDeps {
  readQueue: () => Promise<QualityGateQueueSnapshot>;
  readMemory: () => Promise<QualityGateMemorySample | null>;
  readHardReserveBytes: () => Promise<number>;
  readEstimate: (footprintKey: string) => Promise<number>;
  readStarvationMs: () => Promise<number>;
  readRecord: () => Promise<GateStarvationRecord | null>;
  writeRecord: (record: GateStarvationRecord) => Promise<void>;
  clearRecord: () => Promise<void>;
  collectHolders: () => Promise<GateStarvationHolder[]>;
  push: (n: EdgeNotification) => void;
  emitOnce: (entry: EmitActivityOptions & { id: string }) => Promise<ActivityEmitOutcome>;
  now: () => number;
}

async function defaultCollectHolders(): Promise<GateStarvationHolder[]> {
  return topMemoryConsumers(await getRuntimeCensus({ fresh: true }), 3);
}

function resolveDeps(deps: Partial<GateStarvationServiceDeps>): GateStarvationServiceDeps {
  return {
    readQueue: deps.readQueue ?? (() => readQualityGateQueue()),
    readMemory: deps.readMemory ?? readQualityGateMemory,
    readHardReserveBytes: deps.readHardReserveBytes ?? (async () => (await resolveGateReserveBytes()).hardBytes),
    readEstimate: deps.readEstimate ?? ((key) => readGateFootprintEstimate(key, gateAdmissionRoot())),
    readStarvationMs: deps.readStarvationMs ?? resolveQualityGateStarvationMs,
    readRecord: deps.readRecord ?? (() => readGateStarvationRecord()),
    writeRecord: deps.writeRecord ?? ((record) => writeGateStarvationRecord(record)),
    clearRecord: deps.clearRecord ?? (() => clearGateStarvationRecord()),
    collectHolders: deps.collectHolders ?? defaultCollectHolders,
    push: deps.push ?? pushNeedsYouEdge,
    emitOnce: deps.emitOnce ?? emitActivityEntryOnce,
    now: deps.now ?? Date.now,
  };
}

function settled(outcome: ActivityEmitOutcome): boolean {
  return outcome !== 'failed';
}

async function emitOnceSafe(
  emitOnce: GateStarvationServiceDeps['emitOnce'],
  entry: EmitActivityOptions & { id: string },
): Promise<ActivityEmitOutcome> {
  try {
    return await emitOnce(entry);
  } catch {
    return 'failed';
  }
}

const GIB = 1024 ** 3;

function formatGib(bytes: number): string {
  return (bytes / GIB).toFixed(1);
}

function minutesSince(fromMs: number, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - fromMs) / 60_000));
}

function minutesBetween(sinceIso: string, atIso: string): number {
  return Math.max(0, Math.round((Date.parse(atIso) - Date.parse(sinceIso)) / 60_000));
}

/** D8: opening push, sent only while announcing. The record always carries a footprint at opening. */
function openingPush(record: GateStarvationRecord, nowMs: number): EdgeNotification {
  const forIssue = record.head.issueId ? ` for ${record.head.issueId}` : '';
  const footprintBytes = record.footprintBytes ?? 0;
  const body = `${record.head.gateName}${forIssue} has waited ${minutesSince(record.head.createdAt, nowMs)} min; `
    + `it needs ${formatGib(footprintBytes)} GiB above the ${formatGib(record.hardReserveBytes)} GiB hard reserve `
    + `and ${formatGib(record.memAvailableBytes)} GiB is available.`;
  return {
    kind: 'failed',
    category: 'failed',
    tag: `gate-starvation:${record.since}`,
    title: 'Gate queue stalled on memory',
    publicTitle: 'Gate queue stalled on memory',
    body,
    url: '/m',
    issueId: record.head.issueId ?? null,
  };
}

function openingEntry(record: GateStarvationRecord, nowMs: number): EmitActivityOptions & { id: string } {
  return {
    id: `gate-starvation:${record.since}:opened`,
    source: 'cloister',
    level: 'warn',
    link: '/flywheel',
    message: formatGateStarvationLine(record, { now: nowMs }),
    desktop: false,
  };
}

function recoveryEntry(record: GateStarvationRecord): EmitActivityOptions & { id: string } {
  const closing = record.closing!;
  const minutes = minutesBetween(record.since, closing.at);
  const cause = closing.reason === 'admitted' ? 'a gate was admitted' : 'the queue emptied';
  return {
    id: `gate-starvation:${record.since}:recovered`,
    source: 'cloister',
    level: 'info',
    link: '/flywheel',
    message: `Gate admission queue is moving again after ${minutes} min: ${cause}.`,
  };
}

/** D5.1/2: push + emit the opening notice; marks the record announced only once the emit settles. */
async function announce(deps: GateStarvationServiceDeps, record: GateStarvationRecord, nowMs: number): Promise<void> {
  try {
    deps.push(openingPush(record, nowMs));
  } catch {
    // Phone delivery is best-effort (NFR-7).
  }
  const outcome = await emitOnceSafe(deps.emitOnce, openingEntry(record, nowMs));
  if (settled(outcome)) await deps.writeRecord({ ...record, announced: true });
}

/** D5.3: finish a closing episode; deletes the record only once the recovery emit settles. */
async function settleClosing(deps: GateStarvationServiceDeps, record: GateStarvationRecord): Promise<void> {
  if (!record.announced) {
    await deps.clearRecord();
    return;
  }
  const outcome = await emitOnceSafe(deps.emitOnce, recoveryEntry(record));
  if (settled(outcome)) await deps.clearRecord();
}

/** D5.4: re-reads the new head's inputs and rewrites the record; emits nothing. */
async function handleHandover(deps: GateStarvationServiceDeps, record: GateStarvationRecord, snapshot: QualityGateQueueSnapshot): Promise<void> {
  const newHead = snapshot.waiters[0];
  if (!newHead?.ticketId || newHead.ticketId === record.head.ticketId) return;

  const memory = await deps.readMemory().catch(() => null);
  const hardReserveBytes = await deps.readHardReserveBytes().catch(() => record.hardReserveBytes);
  let footprintBytes: number | null = null;
  if (newHead.footprintKey) {
    const estimate = await deps.readEstimate(newHead.footprintKey).catch(() => null);
    footprintBytes = estimate !== null && memory
      ? fitsAloneAboveHardReserve({
        memAvailableBytes: memory.memAvailableBytes,
        memTotalBytes: memory.memTotalBytes,
        hardReserveBytes,
        estimateBytes: estimate,
      }).footprintBytes
      : record.footprintBytes;
  }

  await deps.writeRecord({
    ...record,
    head: {
      ticketId: newHead.ticketId,
      ...(newHead.issueId ? { issueId: newHead.issueId } : {}),
      gateName: newHead.gateName,
      workspacePath: newHead.workspacePath,
      createdAt: newHead.createdAt,
    },
    memAvailableBytes: memory?.memAvailableBytes ?? record.memAvailableBytes,
    hardReserveBytes,
    footprintBytes,
  });
}

/** The five-step poll algorithm (D5), run under the in-flight guard in `pollOnce`. */
async function runGateStarvationPoll(deps: GateStarvationServiceDeps): Promise<void> {
  const nowMs = deps.now();
  const snapshot = await deps.readQueue();
  // Step 1: an unreadable queue is unknown, never empty; leave the record untouched.
  if (snapshot.readError) return;

  const record = await deps.readRecord();

  // Step 3: finish a closing episode.
  if (record?.closing) {
    await settleClosing(deps, record);
    return;
  }

  // Step 4: an open episode.
  if (record) {
    const reason = starvationEpisodeCloseReason(snapshot, record.openedAtMs);
    if (reason) {
      const closingRecord: GateStarvationRecord = { ...record, closing: { at: new Date(nowMs).toISOString(), reason } };
      await deps.writeRecord(closingRecord);
      await settleClosing(deps, closingRecord);
      return;
    }
    if (!record.announced) await announce(deps, record, nowMs);
    await handleHandover(deps, record, snapshot);
    return;
  }

  // Step 5: detect a new episode.
  const starvationMs = await deps.readStarvationMs();
  const memory = await deps.readMemory();
  const hardReserveBytes = await deps.readHardReserveBytes();
  const head = snapshot.waiters[0];
  const headEstimateBytes = head?.footprintKey ? await deps.readEstimate(head.footprintKey) : null;
  const verdict = evaluateGateStarvation({ snapshot, memory, hardReserveBytes, headEstimateBytes, starvationMs, now: nowMs });
  if (!verdict.starved) return;

  const holders = await deps.collectHolders().catch((): GateStarvationHolder[] => []);
  const newRecord: GateStarvationRecord = {
    version: 1,
    since: new Date(nowMs).toISOString(),
    openedAtMs: nowMs,
    announced: false,
    head: {
      ticketId: verdict.head.ticketId!,
      ...(verdict.head.issueId ? { issueId: verdict.head.issueId } : {}),
      gateName: verdict.head.gateName,
      workspacePath: verdict.head.workspacePath,
      createdAt: verdict.head.createdAt,
    },
    memAvailableBytes: verdict.memAvailableBytes,
    hardReserveBytes,
    footprintBytes: verdict.footprintBytes,
    holders,
  };
  await deps.writeRecord(newRecord);
  await announce(deps, newRecord, nowMs);
}

interface GateStarvationServiceState {
  deps: GateStarvationServiceDeps;
  pollInFlight: boolean;
}

let state: GateStarvationServiceState | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** In-flight guard plus the NFR-4 catch-all: a failed poll logs and never throws out of the timer. */
async function pollOnce(s: GateStarvationServiceState): Promise<void> {
  if (s.pollInFlight) return;
  s.pollInFlight = true;
  try {
    await runGateStarvationPoll(s.deps);
  } catch (error) {
    console.warn('[gate-starvation] poll failed:', error instanceof Error ? error.message : String(error));
  } finally {
    s.pollInFlight = false;
  }
}

function tick(): void {
  if (!state) return;
  void pollOnce(state);
}

/** Idempotent. Runs one poll immediately, then every `GATE_STARVATION_POLL_MS`. */
export function startGateStarvationService(deps: Partial<GateStarvationServiceDeps> = {}): void {
  if (state !== null) return;
  state = { deps: resolveDeps(deps), pollInFlight: false };
  tick();
  timer = setInterval(tick, GATE_STARVATION_POLL_MS);
  timer.unref?.();
}

export function stopGateStarvationService(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  state = null;
}

/** Exported for tests: force one poll outside the interval. */
export async function pollGateStarvationOnceForTests(): Promise<void> {
  if (!state) return;
  await pollOnce(state);
}
