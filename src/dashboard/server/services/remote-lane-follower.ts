/**
 * The remote-lane follower (.pan/drafts/PAN-4638.md WI-7, FR-4, NFR-4, NFR-5,
 * D-4638-14): keeps each remote lane's stand-in in step with the lane it stands
 * for on another machine.
 *
 * - At start it follows every stand-in that is not archived here and whose
 *   mirror is not `gone`, so a dashboard restart resumes from `lastSeq`.
 * - While the owner's link is online it polls
 *   `GET /api/machines/work/lanes/<name>/status?after=<lastSeq>` as the
 *   operator every 5 s, mirrors each new report into
 *   `agents/conv-<name>/reports/` (keeping `git` and `verdict`), and writes the
 *   mirror: activity, git facts, cost, spawn error, last message, last seen.
 * - 404 `unknown-lane` means the owner no longer has the lane: the mirror
 *   becomes `gone` and following stops. The owner reporting `archived` keeps
 *   following until home's reap writes `archived.json`.
 * - When the link is not online or a call fails, it sets `unreachableSince`
 *   once and backs off 1 s doubling to 300 s (±20 % jitter). It never gives up.
 * - A remote lane does not stop when its parent ends (D-4638-14), as local
 *   lanes do not.
 *
 * The owner is the authority: this service writes only `mirror.json` and the
 * mirrored reports.
 */
import type { LaneActivity } from '@overdeck/contracts';

import { mirrorRemoteReport } from '../../../lib/agents/worker/remote-standin.js';
import type { WorkerReport } from '../../../lib/agents/worker/report.js';
import { linkFetch } from '../../../lib/anywhere/link-client.js';
import {
  listRemoteLanes,
  readRemoteLane,
  writeRemoteLaneMirror,
  type RemoteLane,
  type RemoteLaneMirror,
} from '../../../lib/lanes/remote-lanes.js';
import type { LaneGitFacts } from '../../../lib/lanes/types.js';
import { FOLLOW_POLL_MS, followBackoffMs } from './remote-worker-follower.js';

const STATUS_TIMEOUT_MS = 10_000;
const LANE_ACTIVITIES: ReadonlySet<string> = new Set(['failed-to-start', 'needs-you', 'working', 'idle', 'starting', 'stopped']);

export interface RemoteLaneFollowerDeps {
  list: () => Promise<RemoteLane[]>;
  read: (name: string) => Promise<RemoteLane | null>;
  writeMirror: (name: string, mirror: RemoteLaneMirror) => Promise<void>;
  mirrorReport: (id: string, report: WorkerReport) => Promise<void>;
  isOnline: (environmentId: string) => boolean;
  fetch: (environmentId: string, path: string, init: { method: 'GET'; signal: AbortSignal }) => Promise<{ status: number; json: unknown }>;
  now: () => Date;
  random: () => number;
  log: (message: string) => void;
}

interface StatusAnswer {
  activity: LaneActivity;
  lastActivityAt: string | null;
  archived: boolean;
  git: LaneGitFacts | null;
  costUsd: number | null;
  spawnError: string | null;
  reports: WorkerReport[];
  lastAssistantMessage: string | null;
}

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function decodeGit(value: unknown): LaneGitFacts | null {
  const git = value as Partial<LaneGitFacts> | null;
  if (!git || typeof git !== 'object') return null;
  return {
    branch: stringOrNull(git.branch),
    head: stringOrNull(git.head),
    ahead: typeof git.ahead === 'number' ? git.ahead : null,
    dirty: git.dirty === true,
  };
}

function decodeStatus(json: unknown): StatusAnswer | null {
  const body = json as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || typeof body['activity'] !== 'string' || !LANE_ACTIVITIES.has(body['activity']) || !Array.isArray(body['reports'])) {
    return null;
  }
  return {
    activity: body['activity'] as LaneActivity,
    lastActivityAt: stringOrNull(body['lastActivityAt']),
    archived: body['archived'] === true,
    git: decodeGit(body['git']),
    costUsd: typeof body['costUsd'] === 'number' ? body['costUsd'] : null,
    spawnError: stringOrNull(body['spawnError']),
    reports: (body['reports'] as unknown[]).filter((report): report is WorkerReport => {
      const candidate = report as Partial<WorkerReport> | null;
      return !!candidate && typeof candidate.seq === 'number' && typeof candidate.body === 'string' && typeof candidate.at === 'string';
    }),
    lastAssistantMessage: stringOrNull(body['lastAssistantMessage']),
  };
}

/** The mirror before the first answer: the lane is starting, nothing mirrored yet. */
export function initialLaneMirror(): RemoteLaneMirror {
  return {
    v: 1, state: 'running', activity: 'starting', lastActivityAt: null, git: null, costUsd: null, ownerArchived: false,
    lastSeq: 0, lastSeenAt: null, unreachableSince: null, lastAssistantMessage: null, spawnError: null,
  };
}

interface Tracked {
  timer: NodeJS.Timeout | null;
  failures: number;
}

export class RemoteLaneFollower {
  private readonly tracked = new Map<string, Tracked>();
  private stopped = false;

  constructor(private readonly deps: RemoteLaneFollowerDeps) {}

  /** Resume every stand-in that is not archived here and not gone on its owner. */
  async start(): Promise<void> {
    this.stopped = false;
    for (const lane of await this.deps.list()) {
      if (lane.archivedAt === null && lane.mirror?.state !== 'gone') this.track(lane.facts.name);
    }
  }

  /** Follow one remote lane (a new launch, or one found at start); polls at once. Idempotent. */
  track(name: string): void {
    if (this.stopped || this.tracked.has(name)) return;
    this.tracked.set(name, { timer: null, failures: 0 });
    this.schedule(name, 0);
  }

  isTracking(name: string): boolean {
    return this.tracked.has(name);
  }

  stop(): void {
    this.stopped = true;
    for (const entry of this.tracked.values()) if (entry.timer) clearTimeout(entry.timer);
    this.tracked.clear();
  }

  private schedule(name: string, delayMs: number): void {
    const entry = this.tracked.get(name);
    if (!entry || this.stopped) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.poll(name).catch((error: Error) => this.deps.log(`lane follower ${name}: ${error.message}`));
    }, delayMs);
    entry.timer.unref?.();
  }

  private async backOff(name: string, mirror: RemoteLaneMirror): Promise<void> {
    const entry = this.tracked.get(name);
    if (!entry) return;
    if (mirror.unreachableSince === null) await this.deps.writeMirror(name, { ...mirror, unreachableSince: this.deps.now().toISOString() });
    const delay = followBackoffMs(entry.failures, this.deps.random);
    entry.failures += 1;
    this.schedule(name, delay);
  }

  private async status(environmentId: string, name: string, after: number): Promise<{ status: number; json: unknown } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
    try {
      return await this.deps.fetch(environmentId, `/api/machines/work/lanes/${encodeURIComponent(name)}/status?after=${after}`, {
        method: 'GET',
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async poll(name: string): Promise<void> {
    const entry = this.tracked.get(name);
    if (!entry) return;
    const lane = await this.deps.read(name);
    if (!lane || lane.archivedAt !== null || lane.mirror?.state === 'gone') {
      this.tracked.delete(name);
      return;
    }
    const mirror = lane.mirror ?? initialLaneMirror();
    const { environmentId } = lane.facts;
    if (!this.deps.isOnline(environmentId)) return this.backOff(name, mirror);

    const answer = await this.status(environmentId, name, mirror.lastSeq);
    if (answer?.status === 404 && (answer.json as { code?: unknown } | null)?.code === 'unknown-lane') {
      // The owner no longer has the lane: nothing more will arrive.
      await this.deps.writeMirror(name, { ...mirror, state: 'gone', activity: 'stopped', unreachableSince: null, lastSeenAt: this.deps.now().toISOString() });
      this.tracked.delete(name);
      return;
    }
    const status = answer?.status === 200 ? decodeStatus(answer.json) : null;
    if (!status) return this.backOff(name, mirror);

    entry.failures = 0;
    let lastSeq = mirror.lastSeq;
    for (const report of [...status.reports].sort((a, b) => a.seq - b.seq)) {
      if (report.seq <= lastSeq) continue;
      await this.deps.mirrorReport(`conv-${name}`, report);
      lastSeq = report.seq;
    }
    await this.deps.writeMirror(name, {
      v: 1,
      state: 'running',
      activity: status.activity,
      lastActivityAt: status.lastActivityAt,
      git: status.git,
      costUsd: status.costUsd,
      ownerArchived: status.archived,
      lastSeq,
      lastSeenAt: this.deps.now().toISOString(),
      unreachableSince: null,
      lastAssistantMessage: status.lastAssistantMessage,
      spawnError: status.spawnError,
    });
    this.schedule(name, FOLLOW_POLL_MS);
  }
}

export const defaultRemoteLaneFollowerDeps = (isOnline: (environmentId: string) => boolean): RemoteLaneFollowerDeps => ({
  list: () => listRemoteLanes({}),
  read: readRemoteLane,
  writeMirror: writeRemoteLaneMirror,
  mirrorReport: mirrorRemoteReport,
  isOnline,
  fetch: (environmentId, path, init) => linkFetch(environmentId, path, { ...init, actor: 'operator' }),
  now: () => new Date(),
  random: Math.random,
  log: (message) => console.warn(`[anywhere] ${message}`),
});

let current: RemoteLaneFollower | null = null;

/** The primary dashboard's lane follower (set in `startAnywhere`); null elsewhere. */
export function currentRemoteLaneFollower(): RemoteLaneFollower | null {
  return current;
}

export function setRemoteLaneFollower(follower: RemoteLaneFollower | null): void {
  current = follower;
}

/** Start following a remote lane home just launched; a no-op where no follower runs. */
export function followRemoteLane(name: string): void {
  current?.track(name);
}
