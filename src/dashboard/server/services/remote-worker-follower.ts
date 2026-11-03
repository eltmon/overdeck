/**
 * The remote-worker follower (PAN-4651 FR-2, D-4651-5): keeps each stand-in
 * worker in step with the worker it stands for on another machine.
 *
 * - At start it loads every `remote.json` whose state is `running`, so a
 *   dashboard restart resumes from each stand-in's `lastSeq`.
 * - While the owner's link is online it polls `GET /api/workers/<remoteId>/status?after=<lastSeq>`
 *   every 5 s, mirrors each new report with the owner's `seq`, and records the
 *   idle age and last-seen time. A confirmed-dead worker becomes `exited` with
 *   its last assistant message, but only once it was seen alive or the startup
 *   grace (`WAIT_STARTUP_GRACE_MS`, as `pan worker wait` uses) has passed since
 *   the stand-in was created: until the launcher starts the harness, the
 *   owner's liveness reads `runtime-missing`, which counts as dead (PAN-4774).
 * - When the link is not online or a call fails, it backs off 1 s doubling to
 *   300 s (±20 % jitter) and sets `unreachableSince`. It never gives up on its
 *   own: a sleeping desktop delays the report, never fails it.
 * - Parent stop cascade: an agent parent (`agent-…`) is checked with the
 *   liveness oracle, a conversation parent (`conv-…`) by its row (archived or
 *   ended). Two consecutive dead observations post the owner's stop as the
 *   operator (this machine cleaning up its own delegation) and set `stopped`.
 *   Any other parent never cascades.
 *
 * The owner is the authority (NFR-3): this service writes only the stand-in.
 */
import { isAlive, isConfirmedDead } from '../../../lib/agents/liveness.js';
import type { WorkerReport } from '../../../lib/agents/worker/report.js';
import { WAIT_STARTUP_GRACE_MS } from '../../../lib/agents/worker/wait.js';
import {
  listRemoteStandIns,
  mirrorRemoteReport,
  readRemoteStandIn,
  type RemoteStandIn,
  writeRemoteStandIn,
} from '../../../lib/agents/worker/remote-standin.js';
import { linkFetch } from '../../../lib/anywhere/link-client.js';
import { getConversationByTmuxSession } from '../../../lib/overdeck/conversations.js';

export const FOLLOW_POLL_MS = 5_000;
export const FOLLOW_BACKOFF_START_MS = 1_000;
export const FOLLOW_BACKOFF_CAP_MS = 300_000;
const STATUS_TIMEOUT_MS = 10_000;

export interface RemoteWorkerFollowerDeps {
  list: () => Promise<Array<{ localId: string; standIn: RemoteStandIn }>>;
  read: (localId: string) => Promise<RemoteStandIn | null>;
  write: (localId: string, standIn: RemoteStandIn) => Promise<void>;
  mirror: (localId: string, report: WorkerReport) => Promise<void>;
  isOnline: (environmentId: string) => boolean;
  fetch: (environmentId: string, path: string, init: { method: 'GET' | 'POST'; body?: unknown; signal: AbortSignal }) => Promise<{ status: number; json: unknown }>;
  /** true = confirmed gone; false = alive; null = this parent never cascades. */
  parentGone: (parentId: string) => Promise<boolean | null>;
  now: () => Date;
  random: () => number;
  log: (message: string) => void;
}

interface StatusAnswer {
  liveness: { alive: boolean; confirmedDead: boolean };
  idleAgeMs: number | null;
  reports: WorkerReport[];
  lastAssistantMessage: string | null;
}

function decodeStatus(json: unknown): StatusAnswer | null {
  const body = json as Partial<StatusAnswer> | null;
  if (!body || typeof body !== 'object' || !body.liveness || !Array.isArray(body.reports)) return null;
  return {
    liveness: { alive: body.liveness.alive === true, confirmedDead: body.liveness.confirmedDead === true },
    idleAgeMs: typeof body.idleAgeMs === 'number' ? body.idleAgeMs : null,
    reports: body.reports.filter((report): report is WorkerReport =>
      !!report && typeof report.seq === 'number' && typeof report.body === 'string' && typeof report.at === 'string'),
    lastAssistantMessage: typeof body.lastAssistantMessage === 'string' ? body.lastAssistantMessage : null,
  };
}

/** 1 s doubling to 300 s with ±20 % jitter (`random` 0.5 ⇒ no jitter). */
export function followBackoffMs(attempt: number, random: () => number): number {
  const base = Math.min(FOLLOW_BACKOFF_CAP_MS, FOLLOW_BACKOFF_START_MS * 2 ** attempt);
  return Math.round(base * (0.8 + 0.4 * random()));
}

interface Tracked {
  timer: NodeJS.Timeout | null;
  failures: number;
  parentDeadPolls: number;
  seenAlive: boolean;
}

export class RemoteWorkerFollower {
  private readonly tracked = new Map<string, Tracked>();
  private stopped = false;

  constructor(private readonly deps: RemoteWorkerFollowerDeps) {}

  /** Resume every running stand-in on disk. */
  async start(): Promise<void> {
    this.stopped = false;
    for (const { localId, standIn } of await this.deps.list()) {
      if (standIn.state === 'running') this.track(localId);
    }
  }

  /** Follow one stand-in (a new delegation, or one found at start); polls at once. */
  track(localId: string): void {
    if (this.stopped || this.tracked.has(localId)) return;
    this.tracked.set(localId, { timer: null, failures: 0, parentDeadPolls: 0, seenAlive: false });
    this.schedule(localId, 0);
  }

  isTracking(localId: string): boolean {
    return this.tracked.has(localId);
  }

  stop(): void {
    this.stopped = true;
    for (const entry of this.tracked.values()) if (entry.timer) clearTimeout(entry.timer);
    this.tracked.clear();
  }

  private schedule(localId: string, delayMs: number): void {
    const entry = this.tracked.get(localId);
    if (!entry || this.stopped) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.poll(localId).catch((error: Error) => this.deps.log(`follower ${localId}: ${error.message}`));
    }, delayMs);
    entry.timer.unref?.();
  }

  private finish(localId: string): void {
    this.tracked.delete(localId);
  }

  private async backOff(localId: string, standIn: RemoteStandIn): Promise<void> {
    const entry = this.tracked.get(localId);
    if (!entry) return;
    if (standIn.unreachableSince === null) await this.deps.write(localId, { ...standIn, unreachableSince: this.deps.now().toISOString() });
    const delay = followBackoffMs(entry.failures, this.deps.random);
    entry.failures += 1;
    this.schedule(localId, delay);
  }

  private async call(standIn: RemoteStandIn, path: string, method: 'GET' | 'POST'): Promise<{ status: number; json: unknown } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
    try {
      return await this.deps.fetch(standIn.environmentId, path, { method, ...(method === 'POST' ? { body: {} } : {}), signal: controller.signal });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async poll(localId: string): Promise<void> {
    const entry = this.tracked.get(localId);
    if (!entry) return;
    const standIn = await this.deps.read(localId);
    if (!standIn || standIn.state !== 'running') return this.finish(localId);
    if (!this.deps.isOnline(standIn.environmentId)) return this.backOff(localId, standIn);

    const answer = await this.call(standIn, `/api/workers/${encodeURIComponent(standIn.remoteId)}/status?after=${standIn.lastSeq}`, 'GET');
    if (answer?.status === 404 && (answer.json as { code?: unknown } | null)?.code === 'unknown-worker') {
      // The owner no longer knows the worker: nothing more will arrive.
      await this.deps.write(localId, { ...standIn, state: 'exited', unreachableSince: null, lastSeenAt: this.deps.now().toISOString() });
      return this.finish(localId);
    }
    const status = answer?.status === 200 ? decodeStatus(answer.json) : null;
    if (!status) return this.backOff(localId, standIn);

    entry.failures = 0;
    let lastSeq = standIn.lastSeq;
    for (const report of [...status.reports].sort((a, b) => a.seq - b.seq)) {
      if (report.seq <= lastSeq) continue;
      await this.deps.mirror(localId, report);
      lastSeq = report.seq;
    }
    let next: RemoteStandIn = {
      ...standIn, lastSeq, idleAgeMs: status.idleAgeMs, lastSeenAt: this.deps.now().toISOString(), unreachableSince: null,
    };
    if (status.liveness.alive) entry.seenAlive = true;
    const pastStartup = entry.seenAlive || this.deps.now().getTime() - Date.parse(standIn.createdAt) >= WAIT_STARTUP_GRACE_MS;
    if (status.liveness.confirmedDead && pastStartup) {
      next = { ...next, state: 'exited', lastAssistantMessage: status.lastAssistantMessage };
      await this.deps.write(localId, next);
      return this.finish(localId);
    }
    if (standIn.parentId !== null && await this.parentDeadTwice(entry, standIn.parentId)) {
      const stopped = await this.call(standIn, `/api/workers/${encodeURIComponent(standIn.remoteId)}/stop`, 'POST');
      if (stopped?.status === 200 || stopped?.status === 404) {
        await this.deps.write(localId, { ...next, state: 'stopped' });
        return this.finish(localId);
      }
      this.deps.log(`follower ${localId}: the stop on ${standIn.label} answered ${stopped?.status ?? 'nothing'}; retrying`);
    }
    await this.deps.write(localId, next);
    this.schedule(localId, FOLLOW_POLL_MS);
  }

  private async parentDeadTwice(entry: Tracked, parentId: string): Promise<boolean> {
    const gone = await this.deps.parentGone(parentId).catch(() => false);
    if (gone === true) entry.parentDeadPolls += 1;
    else entry.parentDeadPolls = 0;
    return entry.parentDeadPolls >= 2;
  }
}

/** Agent parents by the liveness oracle, conversation parents by their row; anything else never cascades. */
export async function defaultParentGone(parentId: string): Promise<boolean | null> {
  if (parentId.startsWith('agent-')) return isConfirmedDead(await isAlive(parentId));
  if (parentId.startsWith('conv-')) {
    const conversation = getConversationByTmuxSession(parentId);
    return conversation ? conversation.archivedAt !== null || conversation.status === 'ended' : false;
  }
  return null;
}

export const defaultRemoteWorkerFollowerDeps = (isOnline: (environmentId: string) => boolean): RemoteWorkerFollowerDeps => ({
  list: listRemoteStandIns,
  read: readRemoteStandIn,
  write: writeRemoteStandIn,
  mirror: mirrorRemoteReport,
  isOnline,
  fetch: (environmentId, path, init) => linkFetch(environmentId, path, { ...init, actor: 'operator' }),
  parentGone: defaultParentGone,
  now: () => new Date(),
  random: Math.random,
  log: (message) => console.warn(`[anywhere] ${message}`),
});

let current: RemoteWorkerFollower | null = null;

/** The primary dashboard's follower (set in `startAnywhere`); null elsewhere. */
export function currentRemoteWorkerFollower(): RemoteWorkerFollower | null {
  return current;
}

export function setRemoteWorkerFollower(follower: RemoteWorkerFollower | null): void {
  current = follower;
}
