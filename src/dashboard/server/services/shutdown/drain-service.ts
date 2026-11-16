/**
 * The shutdown drain (PAN-5342, WI-5; D-4, D-5, D-8, D-9, D-10, D-11, D-13).
 *
 * Runs in the dashboard, the one process with the runtime mirror (D-5).
 * `startShutdown` writes the shutdown record, which closes every admission door
 * (D-1, D-2), then ticks every `DRAIN_TICK_MS`:
 *   1. census the live sessions (`listLiveSessionIds`; `null` stops nothing);
 *   2. stop each one at a turn boundary (D-4), or every one once force applies
 *      (D-8), and confirm the pane is gone before recording it as stopped;
 *   3. with no session left, wait for server-side writers (force stops waiting,
 *      never kills one), verify, mark `complete`, release the reboot guard and
 *      launch the detached final stage.
 * Agents stop with cause `operator`, so `stoppedByUser` blocks autonomous
 * resume (D-9); conversations stop through `handleConversationStop`.
 * Cancel runs the shared `endShutdown(record)` (D-10). The banner snapshot is
 * derived each tick and emitted in memory only (`system.shutdown_changed`).
 *
 * Test seam: `_setDrainDepsForTests(partial)` merges over the production deps
 * (`_resetShutdownForTests()` restores them). Tests pass a full `DrainDeps`.
 */
import type { AgentRuntimeSnapshot, ShutdownPendingSession, ShutdownSnapshot, ShutdownWriter } from '@overdeck/contracts';
import { Effect } from 'effect';

import { getRuntimeSnapshot } from '../../../../lib/agent-runtime-mirror.js';
import { isAlive, isConfirmedDead, isSessionAtTurnBoundary } from '../../../../lib/agents/liveness.js';
import { readRestartLockHolder } from '../../../../lib/restart-lock.js';
import { deleteShutdownRecord, readShutdownRecord, writeShutdownRecord } from '../../../../lib/shutdown/drain-record.js';
import type { ShutdownRecord, ShutdownStoppedSession } from '../../../../lib/shutdown/drain-record.js';
import { endShutdown, seedShutdownOfferLazily } from './end.js';
import { spawnFinalStage } from './final-stage.js';
import { describeSession, listLiveSessionIds, stopAgentAsOperator, stopConversationByName, type SessionInfo } from './preview.js';
import { releaseRebootGuard } from './reboot-guard.js';
import { verifyQuiet } from './verify.js';
import { listWriters } from './writers.js';

export const DRAIN_TICK_MS = 2_000;
export const STOP_RETRY_MS = 10_000;
/** Cancel waits at most this long for an in-flight tick before ending the drain. */
const CANCEL_TICK_WAIT_MS = 30_000;
const BACKEND_SILENT = 'The terminal backend did not answer; no session was stopped this tick';

export type StartResult =
  | { started: true; snapshot: ShutdownSnapshot }
  | { started: false; reason: 'already-running' }
  | { started: false; reason: 'restart-in-progress'; pid: number };

export interface DrainDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  atTurnBoundary: (id: string) => boolean;
  isConfirmedStopped: (id: string) => Promise<boolean>;
  listLiveSessionIds: () => Promise<ReadonlySet<string> | null>;
  runtime: (id: string) => AgentRuntimeSnapshot | null;
  describeSession: (id: string) => Promise<SessionInfo>;
  stopAgent: (id: string) => Promise<void>;
  stopConversation: (name: string) => Promise<void>;
  listWriters: () => Promise<ShutdownWriter[]>;
  verifyQuiet: () => Promise<string[]>;
  spawnFinalStage: (opts: { reboot: boolean }) => Promise<void>;
  emit: (snapshot: ShutdownSnapshot | null) => void;
  releaseRebootGuard: () => void;
  seedResumeOffer: (sessions: readonly ShutdownStoppedSession[]) => void | Promise<void>;
  readRestartLockHolder: () => Promise<{ pid: number } | null>;
  readRecord: () => Promise<ShutdownRecord | null>;
  writeRecord: (record: ShutdownRecord) => Promise<void>;
  deleteRecord: () => Promise<void>;
}

const productionDeps: DrainDeps = {
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  atTurnBoundary: isSessionAtTurnBoundary,
  isConfirmedStopped: async (id) => isConfirmedDead(await isAlive(id)),
  listLiveSessionIds: () => listLiveSessionIds(),
  runtime: (id) => Effect.runSync(getRuntimeSnapshot(id)),
  describeSession,
  stopAgent: stopAgentAsOperator,
  stopConversation: stopConversationByName,
  listWriters: () => listWriters(),
  verifyQuiet: () => verifyQuiet(),
  spawnFinalStage: (opts) => spawnFinalStage(opts),
  emit: (shutdown) => {
    void import('../../event-store.js')
      .then(({ getEventStore }) => getEventStore().emitOnly({ type: 'system.shutdown_changed', timestamp: new Date().toISOString(), payload: { shutdown } }))
      .catch(() => undefined); // Event store not ready: the next tick emits again.
  },
  releaseRebootGuard,
  seedResumeOffer: seedShutdownOfferLazily,
  readRestartLockHolder,
  readRecord: readShutdownRecord,
  writeRecord: writeShutdownRecord,
  deleteRecord: deleteShutdownRecord,
};

interface Drain {
  readonly deps: DrainDeps;
  readonly record: ShutdownRecord;
  readonly deadlineMs: number;
  cancelled: boolean; // Set by cancel: the loop stops and nothing is written again.
  warnings: string[]; writers: ShutdownWriter[]; pendingIds: string[];
  readonly wasWorking: Map<string, boolean>; // D-9: mid-turn when first seen.
  readonly info: Map<string, SessionInfo>; readonly lastAttempt: Map<string, number>; readonly stopping: Set<string>;
  persisting: Promise<void>; wake: () => void; currentTick: Promise<unknown>;
}

let deps: DrainDeps = productionDeps;
let drain: Drain | null = null;
let starting = false;
let snapshot: ShutdownSnapshot | null = null;

/** The D-4 stop rule: stop at a turn boundary, or anything once force applies. */
export function shouldStopNow(atBoundary: boolean, effectiveForce: boolean): boolean {
  return effectiveForce || atBoundary;
}

/** Run a best-effort call; a throw logs and yields the fallback. */
function attempt<T>(what: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    console.warn(`[shutdown] ${what} failed:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

function addWarning(d: Drain, warning: string): void {
  if (!d.warnings.includes(warning)) d.warnings.push(warning);
}

function dropWarning(d: Drain, warning: string): void {
  d.warnings = d.warnings.filter((w) => w !== warning);
}

/** Serialized record writes; a cancelled drain never writes again (it would re-freeze every launch). */
function persist(d: Drain): Promise<void> {
  d.persisting = d.persisting.then(() => (d.cancelled ? undefined : d.deps.writeRecord(d.record))).catch((err: unknown) => {
    console.error('[shutdown] could not write the shutdown record:', err instanceof Error ? err.message : err);
  });
  return d.persisting;
}

function effectiveForce(d: Drain): boolean {
  return d.record.force === 'now' || (d.record.force === 'at-deadline' && d.deps.now() >= d.deadlineMs);
}

async function infoFor(d: Drain, id: string): Promise<SessionInfo> {
  const cached = d.info.get(id);
  if (cached) return cached;
  const info = await d.deps.describeSession(id).catch((): SessionInfo => ({ kind: 'agent', label: id }));
  d.info.set(id, info);
  return info;
}

function pendingRow(d: Drain, id: string): ShutdownPendingSession {
  const info = d.info.get(id) ?? { kind: 'agent' as const, label: id };
  const rt = attempt('runtime read', () => d.deps.runtime(id), null);
  return {
    id,
    kind: info.kind,
    label: info.label,
    ...(info.issueId ? { issueId: info.issueId } : {}),
    ...(info.kind === 'conversation' ? { conversationName: info.conversationName } : {}),
    activity: rt?.activity ?? 'unknown',
    ...(rt?.currentTool ? { tool: rt.currentTool } : {}),
    ...(rt?.currentToolDescription ? { toolDescription: rt.currentToolDescription } : {}),
    ...(rt?.toolStartedAt ? { toolStartedAt: rt.toolStartedAt } : {}),
  };
}

function publish(d: Drain): void {
  if (d.cancelled) return;
  const r = d.record;
  snapshot = {
    phase: r.phase,
    startedAt: r.startedAt,
    deadlineAt: r.deadlineAt,
    overdue: r.phase !== 'complete' && d.deps.now() >= d.deadlineMs,
    reboot: r.reboot,
    force: r.force,
    pending: d.pendingIds.map((id) => pendingRow(d, id)),
    writers: d.writers,
    stoppedCount: r.stopped.length,
    warnings: [...d.warnings],
  };
  const s = snapshot;
  attempt('emit', () => d.deps.emit(s), undefined);
}

/** Stop one session and record it only once its pane is confirmed gone. */
async function stopAndConfirm(d: Drain, id: string, ignoreSpacing: boolean): Promise<boolean> {
  if (d.stopping.has(id) || d.record.stopped.some((s) => s.id === id)) return false;
  const last = d.lastAttempt.get(id);
  if (!ignoreSpacing && last !== undefined && d.deps.now() - last < STOP_RETRY_MS) return false;
  d.stopping.add(id);
  try {
    d.lastAttempt.set(id, d.deps.now());
    const info = await infoFor(d, id);
    try {
      if (info.kind === 'conversation') await d.deps.stopConversation(info.conversationName);
      else await d.deps.stopAgent(id);
    } catch (err) {
      console.warn(`[shutdown] stop of ${id} threw:`, err instanceof Error ? err.message : err);
    }
    const gone = await d.deps.isConfirmedStopped(id).catch(() => false);
    const stillLive = `${id}: stop attempted, pane still live`;
    if (!gone) {
      addWarning(d, stillLive);
      return false;
    }
    dropWarning(d, stillLive);
    if (!d.record.stopped.some((s) => s.id === id)) {
      d.record.stopped.push({
        kind: info.kind,
        id,
        ...(info.kind === 'conversation' ? { name: info.conversationName } : {}),
        ...(info.issueId ? { issueId: info.issueId } : {}),
        label: info.label,
        wasWorking: d.wasWorking.get(id) ?? false,
      });
      await persist(d);
    }
    return true;
  } finally {
    d.stopping.delete(id);
  }
}

async function setPhase(d: Drain, phase: ShutdownRecord['phase']): Promise<void> {
  if (d.record.phase === phase) return;
  d.record.phase = phase;
  await persist(d);
}

/** One drain tick. Returns true when the drain reached `complete`. */
async function tick(d: Drain): Promise<boolean> {
  const live = await d.deps.listLiveSessionIds().catch(() => null);
  if (d.cancelled) return false;
  if (live === null) {
    addWarning(d, BACKEND_SILENT);
    publish(d);
    return false;
  }
  dropWarning(d, BACKEND_SILENT);
  const force = effectiveForce(d);
  for (const id of live) {
    if (d.cancelled) return false;
    if (d.record.stopped.some((s) => s.id === id)) continue;
    await infoFor(d, id);
    const atBoundary = d.deps.atTurnBoundary(id);
    if (!d.wasWorking.has(id)) d.wasWorking.set(id, !atBoundary);
    if (shouldStopNow(atBoundary, force)) await stopAndConfirm(d, id, false);
  }
  if (d.cancelled) return false;
  d.pendingIds = [...live].filter((id) => !d.record.stopped.some((s) => s.id === id));
  if (d.pendingIds.length > 0) {
    await setPhase(d, 'draining');
    publish(d);
    return false;
  }
  await setPhase(d, 'waiting-for-writers');
  d.writers = await d.deps.listWriters().catch(() => []);
  if (d.cancelled) return false;
  if (d.writers.length > 0 && !effectiveForce(d)) {
    publish(d);
    return false;
  }
  await setPhase(d, 'verifying');
  publish(d);
  for (const w of await d.deps.verifyQuiet().catch((err: unknown) => [`Verification failed: ${String(err)}`])) addWarning(d, w);
  if (d.cancelled) return false;
  await setPhase(d, 'complete');
  attempt('reboot guard release', () => d.deps.releaseRebootGuard(), undefined);
  publish(d);
  await d.deps.spawnFinalStage({ reboot: d.record.reboot }).catch((err: unknown) => {
    addWarning(d, `The final stage did not start: ${err instanceof Error ? err.message : String(err)}`);
    publish(d);
  });
  return true;
}

async function runLoop(d: Drain): Promise<void> {
  while (!d.cancelled) {
    const current = tick(d).catch((err: unknown) => attempt('drain tick', () => { throw err; }, false));
    d.currentTick = current;
    if ((await current) || d.cancelled) return;
    await new Promise<void>((resolve) => {
      d.wake = resolve;
      void d.deps.sleep(DRAIN_TICK_MS).then(() => resolve());
    });
  }
}

export async function startShutdown(opts: { deadlineSeconds: number; reboot: boolean; force: boolean }): Promise<StartResult> {
  if (drain || starting) return { started: false, reason: 'already-running' };
  starting = true;
  try {
    const d0 = deps;
    if (await d0.readRecord()) return { started: false, reason: 'already-running' };
    const holder = await d0.readRestartLockHolder().catch(() => null);
    if (holder) return { started: false, reason: 'restart-in-progress', pid: holder.pid };
    const startMs = d0.now();
    const deadlineMs = startMs + opts.deadlineSeconds * 1000;
    const record: ShutdownRecord = {
      version: 1,
      startedAt: new Date(startMs).toISOString(),
      deadlineAt: new Date(deadlineMs).toISOString(),
      reboot: opts.reboot,
      force: opts.force ? 'at-deadline' : 'never',
      phase: 'draining',
      stopped: [],
    };
    await d0.writeRecord(record); // From here, every admission door is closed.
    const d: Drain = {
      deps: d0, record, deadlineMs, cancelled: false, warnings: [], writers: [], pendingIds: [],
      wasWorking: new Map(), info: new Map(), lastAttempt: new Map(), stopping: new Set(),
      persisting: Promise.resolve(), wake: () => undefined, currentTick: Promise.resolve(),
    };
    drain = d;
    const live = await d0.listLiveSessionIds().catch(() => null);
    for (const id of live ?? []) {
      d.wasWorking.set(id, !d0.atTurnBoundary(id));
      await infoFor(d, id);
    }
    d.pendingIds = [...(live ?? [])];
    publish(d);
    void runLoop(d);
    return { started: true, snapshot: snapshot! };
  } finally {
    starting = false;
  }
}

/**
 * Cancel (D-10): stop the loop, let an in-flight tick finish (bounded), then
 * end through `endShutdown`. With no drain in this process, a leftover record
 * that is not `complete` ends the same way. Answers why nothing was cancelled:
 * `complete` once the final stage has started, `not-running` with no drain.
 */
export type CancelShutdownResult = 'cancelled' | 'complete' | 'not-running';

export async function cancelShutdown(): Promise<CancelShutdownResult> {
  const d = drain;
  const dd = d?.deps ?? deps;
  if (d) {
    if (d.record.phase === 'complete') return 'complete';
    d.cancelled = true;
    d.wake();
    await Promise.race([d.currentTick, dd.sleep(CANCEL_TICK_WAIT_MS)]);
    await d.persisting;
  }
  const onDisk = await dd.readRecord().catch(() => null);
  if (!d && !onDisk) return 'not-running';
  if (!d && onDisk?.phase === 'complete') return 'complete';
  const record = onDisk ?? d!.record;
  // The in-memory list wins for a session stopped after the last write.
  const stopped = [...record.stopped, ...(d?.record.stopped ?? []).filter((s) => !record.stopped.some((r) => r.id === s.id))];
  await endShutdown({ ...record, stopped }, { deleteRecord: dd.deleteRecord, seedShutdownOffer: dd.seedResumeOffer });
  drain = null;
  snapshot = null;
  attempt('emit', () => dd.emit(null), undefined);
  return 'cancelled';
}

export async function forceStopSession(id: string): Promise<boolean> {
  const d = drain;
  if (!d || d.cancelled || !d.pendingIds.includes(id)) return false;
  await infoFor(d, id);
  if (await stopAndConfirm(d, id, true)) d.pendingIds = d.pendingIds.filter((p) => p !== id);
  publish(d);
  return true;
}

export async function forceAll(): Promise<boolean> {
  const d = drain;
  if (!d || d.cancelled || d.record.phase === 'complete') return false;
  d.record.force = 'now';
  await persist(d);
  publish(d);
  d.wake();
  return true;
}

export function getShutdownSnapshot(): ShutdownSnapshot | null {
  return snapshot;
}

export function _setDrainDepsForTests(partial: Partial<DrainDeps>): void {
  deps = { ...productionDeps, ...partial };
}

export function _resetShutdownForTests(): void {
  if (drain) {
    drain.cancelled = true;
    drain.wake();
  }
  drain = null;
  starting = false;
  snapshot = null;
  deps = productionDeps;
}
