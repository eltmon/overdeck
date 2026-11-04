/**
 * PAN-4651 WI-12 (D-4651-5): the follower mirrors an owner's reports into the
 * stand-in, backs off while the link is offline, resumes from disk, and
 * cascades a dead parent into one stop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkerReport } from '../../../lib/agents/worker/report.js';
import type { RemoteStandIn } from '../../../lib/agents/worker/remote-standin.js';
import { WAIT_STARTUP_GRACE_MS } from '../../../lib/agents/worker/wait.js';
import {
  FOLLOW_BACKOFF_CAP_MS,
  FOLLOW_POLL_MS,
  followBackoffMs,
  RemoteWorkerFollower,
  type RemoteWorkerFollowerDeps,
} from '../services/remote-worker-follower.js';

const LOCAL = 'agent-pan-9-worker-1';

/** In-memory stand-in storage: fake timers cannot wait on real file I/O (remote-standin.test.ts covers the files). */
let disk: Map<string, RemoteStandIn>;
let mirrored: Map<string, WorkerReport>;
const readRemoteStandIn = async (localId: string) => disk.get(localId) ?? null;
const writeRemoteStandIn = async (localId: string, value: RemoteStandIn) => { disk.set(localId, value); };
const mirroredFile = (seq: number) => `${LOCAL}/reports/${String(seq).padStart(4, '0')}.json`;

const report = (seq: number): WorkerReport => ({ seq, at: '2026-11-01T12:00:00.000Z', status: 'done', body: `report ${seq}` });

function standIn(overrides: Partial<RemoteStandIn> = {}): RemoteStandIn {
  return {
    v: 1, environmentId: 'env-desk', label: 'desk', remoteId: 'agent-pan-9-worker-4', parentId: null, issueId: 'PAN-9',
    createdAt: '2026-11-01T12:00:00.000Z', state: 'running', lastSeq: 0, lastSeenAt: null, lastAssistantMessage: null, idleAgeMs: null, unreachableSince: null,
    ...overrides,
  };
}

interface Owner { online: boolean; reports: WorkerReport[]; dead: boolean; stops: number; statusCalls: string[] }

function harness(owner: Owner, parentGone: RemoteWorkerFollowerDeps['parentGone'] = async () => null) {
  const deps: RemoteWorkerFollowerDeps = {
    list: async () => [...disk].map(([localId, standIn]) => ({ localId, standIn })),
    read: readRemoteStandIn,
    write: writeRemoteStandIn,
    mirror: async (localId, value) => { if (!mirrored.has(`${localId}/reports/${String(value.seq).padStart(4, '0')}.json`)) mirrored.set(`${localId}/reports/${String(value.seq).padStart(4, '0')}.json`, value); },
    now: () => new Date(),
    isOnline: () => owner.online,
    fetch: vi.fn(async (_environmentId: string, path: string, init: { method: 'GET' | 'POST' }) => {
      if (init.method === 'POST') {
        owner.stops += 1;
        return { status: 200, json: { stopped: true } };
      }
      owner.statusCalls.push(path);
      const after = Number(new URL(`http://x${path}`).searchParams.get('after'));
      return {
        status: 200,
        json: {
          id: 'agent-pan-9-worker-4', liveness: { alive: !owner.dead, confirmedDead: owner.dead }, idleAgeMs: 1_000,
          reports: owner.reports.filter((r) => r.seq > after), lastAssistantMessage: owner.dead ? 'bye' : null,
        },
      };
    }),
    parentGone,
    random: () => 0.5,
    log: () => undefined,
  };
  return { follower: new RemoteWorkerFollower(deps), deps };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
  disk = new Map();
  mirrored = new Map();
  await writeRemoteStandIn(LOCAL, standIn());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('remote worker follower (D-4651-5)', () => {
  it('ac12: reports 1 and 2 on the owner appear as reports/0001.json and 0002.json in the stand-in', async () => {
    const owner: Owner = { online: true, reports: [report(1)], dead: false, stops: 0, statusCalls: [] };
    const { follower } = harness(owner);
    await follower.start();
    await vi.advanceTimersByTimeAsync(10);
    owner.reports.push(report(2));
    await vi.advanceTimersByTimeAsync(FOLLOW_POLL_MS);
    expect(mirrored.has(mirroredFile(1))).toBe(true);
    expect(mirrored.has(mirroredFile(2))).toBe(true);
    expect(await readRemoteStandIn(LOCAL)).toMatchObject({ state: 'running', lastSeq: 2, idleAgeMs: 1_000 });
    expect(owner.statusCalls.at(-1)).toBe('/api/workers/agent-pan-9-worker-4/status?after=1');
    follower.stop();
  });

  it('ac12: offline, it backs off 1 s, 2 s, 4 s … capped at 300 s and the stand-in stays running', async () => {
    const owner: Owner = { online: false, reports: [], dead: false, stops: 0, statusCalls: [] };
    const { follower, deps } = harness(owner);
    const checks: number[] = [];
    deps.isOnline = () => { checks.push(Date.now()); return false; };
    await follower.start();
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    const gaps = checks.slice(1).map((at, index) => at - checks[index]!);
    // The first check runs at once; later gaps double from 1 s and stop at 300 s.
    expect(gaps.slice(0, 6)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000]);
    expect(Math.max(...gaps)).toBe(FOLLOW_BACKOFF_CAP_MS);
    expect(gaps.at(-1)).toBe(FOLLOW_BACKOFF_CAP_MS);
    expect(await readRemoteStandIn(LOCAL)).toMatchObject({ state: 'running', unreachableSince: '2026-11-01T12:00:00.000Z' });
    expect(followBackoffMs(20, () => 0.5)).toBe(FOLLOW_BACKOFF_CAP_MS);
    expect(followBackoffMs(0, () => 1)).toBe(1_200);
    follower.stop();
  });

  it('ac12: a follower recreated from disk resumes from lastSeq', async () => {
    await writeRemoteStandIn(LOCAL, standIn({ lastSeq: 2 }));
    const owner: Owner = { online: true, reports: [report(1), report(2), report(3)], dead: false, stops: 0, statusCalls: [] };
    const { follower } = harness(owner);
    await follower.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(owner.statusCalls[0]).toBe('/api/workers/agent-pan-9-worker-4/status?after=2');
    expect(mirrored.has(mirroredFile(3))).toBe(true);
    expect(mirrored.has(mirroredFile(1))).toBe(false);
    follower.stop();
  });

  it('ac12: a parent confirmed dead on two polls posts one stop and sets state stopped', async () => {
    await writeRemoteStandIn(LOCAL, standIn({ parentId: 'agent-pan-9' }));
    const owner: Owner = { online: true, reports: [], dead: false, stops: 0, statusCalls: [] };
    const parentGone = vi.fn(async () => true);
    const { follower } = harness(owner, parentGone);
    await follower.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(owner.stops).toBe(0);
    await vi.advanceTimersByTimeAsync(FOLLOW_POLL_MS);
    expect(owner.stops).toBe(1);
    expect(await readRemoteStandIn(LOCAL)).toMatchObject({ state: 'stopped' });
    await vi.advanceTimersByTimeAsync(FOLLOW_POLL_MS * 3);
    expect(owner.stops).toBe(1);
    expect(follower.isTracking(LOCAL)).toBe(false);
  });

  it('a confirmed-dead worker past the startup grace becomes exited with its last assistant message', async () => {
    await writeRemoteStandIn(LOCAL, standIn({ createdAt: new Date(Date.now() - WAIT_STARTUP_GRACE_MS).toISOString() }));
    const owner: Owner = { online: true, reports: [], dead: true, stops: 0, statusCalls: [] };
    const { follower } = harness(owner);
    await follower.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(await readRemoteStandIn(LOCAL)).toMatchObject({ state: 'exited', lastAssistantMessage: 'bye' });
    expect(follower.isTracking(LOCAL)).toBe(false);
  });

  it('PAN-4774: a worker read as dead before its harness starts keeps being followed and its report arrives', async () => {
    // The owner's liveness is `runtime-missing` (dead) until the launcher starts the harness.
    const owner: Owner = { online: true, reports: [], dead: true, stops: 0, statusCalls: [] };
    const { follower } = harness(owner);
    await follower.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(await readRemoteStandIn(LOCAL)).toMatchObject({ state: 'running' });
    owner.dead = false;
    owner.reports.push(report(1));
    await vi.advanceTimersByTimeAsync(FOLLOW_POLL_MS);
    expect(mirrored.has(mirroredFile(1))).toBe(true);
    owner.dead = true;
    await vi.advanceTimersByTimeAsync(FOLLOW_POLL_MS);
    expect(await readRemoteStandIn(LOCAL)).toMatchObject({ state: 'exited', lastSeq: 1, lastAssistantMessage: 'bye' });
    expect(follower.isTracking(LOCAL)).toBe(false);
  });

  it('PAN-4774: a worker never seen alive becomes exited once the startup grace has passed', async () => {
    const owner: Owner = { online: true, reports: [], dead: true, stops: 0, statusCalls: [] };
    const { follower } = harness(owner);
    await follower.start();
    await vi.advanceTimersByTimeAsync(WAIT_STARTUP_GRACE_MS - FOLLOW_POLL_MS);
    expect(await readRemoteStandIn(LOCAL)).toMatchObject({ state: 'running' });
    await vi.advanceTimersByTimeAsync(FOLLOW_POLL_MS * 2);
    expect(await readRemoteStandIn(LOCAL)).toMatchObject({ state: 'exited' });
    expect(follower.isTracking(LOCAL)).toBe(false);
  });
});
