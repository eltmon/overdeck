/**
 * PAN-4638 WI-7: the lane follower mirrors an owner's reports and state into
 * the stand-in, marks a lane the owner no longer has as gone, backs off while
 * the owner is unreachable, and resumes from disk.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkerReport } from '../../../lib/agents/worker/report.js';
import type { RemoteLane, RemoteLaneFacts, RemoteLaneMirror } from '../../../lib/lanes/remote-lanes.js';
import { FOLLOW_POLL_MS } from '../services/remote-worker-follower.js';
import {
  defaultRemoteLaneFollowerDeps,
  initialLaneMirror,
  RemoteLaneFollower,
  type RemoteLaneFollowerDeps,
} from '../services/remote-lane-follower.js';

const NAME = '20261101-4242';

function facts(name: string): RemoteLaneFacts {
  return {
    v: 1, name, environmentId: 'env-fly', label: 'fly-abc', run: 'hotel', key: '663', role: 'critic', iteration: 1,
    parentName: 'orch', criticOfName: '20261101-0001', projectKey: 'lexerra', cwd: '/workspace/lanes/hotel-663-critic-i1',
    branch: null, at: 'abc1234', model: 'claude-opus-5-5', harness: 'claude-code', effort: 'high', title: 'hotel 663 · critic',
    createdAt: '2026-11-01T12:00:00.000Z',
  };
}

const report = (seq: number): WorkerReport => ({
  seq,
  at: '2026-11-01T12:00:00.000Z',
  status: 'done',
  body: `report ${seq}`,
  git: { head: `head${seq}`, branch: null },
  verdict: { value: 'WOWED', defects: 0, file: `/v/${seq}.json` },
} as WorkerReport);

/** In-memory stand-in storage: fake timers cannot wait on real file I/O (the last test covers the files). */
let lanes: Map<string, RemoteLane>;
let mirrored: Map<string, WorkerReport>;

interface Owner { online: boolean; reports: WorkerReport[]; fail: boolean; gone: boolean; calls: string[]; callTimes: number[] }

function harness(owner: Owner) {
  const deps: RemoteLaneFollowerDeps = {
    list: async () => [...lanes.values()],
    read: async (name) => lanes.get(name) ?? null,
    writeMirror: async (name, mirror) => {
      const lane = lanes.get(name);
      if (lane) lanes.set(name, { ...lane, mirror });
    },
    mirrorReport: async (id, value) => {
      const file = `${id}/reports/${String(value.seq).padStart(4, '0')}.json`;
      if (!mirrored.has(file)) mirrored.set(file, value);
    },
    isOnline: () => owner.online,
    fetch: vi.fn(async (_environmentId: string, path: string) => {
      owner.calls.push(path);
      owner.callTimes.push(Date.now());
      if (owner.fail) throw new Error('socket hang up');
      if (owner.gone) return { status: 404, json: { code: 'unknown-lane', error: 'no such lane' } };
      const after = Number(new URL(`http://x${path}`).searchParams.get('after'));
      return {
        status: 200,
        json: {
          activity: 'working', lastActivityAt: '2026-11-01T12:00:05.000Z', archived: false,
          git: { branch: null, head: 'abc1234', ahead: 0, dirty: false }, costUsd: 0.25, cwd: '/workspace/lanes/x', spawnError: null,
          reports: owner.reports.filter((entry) => entry.seq > after), lastAssistantMessage: null,
        },
      };
    }),
    now: () => new Date(),
    random: () => 0.5,
    log: () => undefined,
  };
  return { follower: new RemoteLaneFollower(deps), deps };
}

function owner(overrides: Partial<Owner> = {}): Owner {
  return { online: true, reports: [], fail: false, gone: false, calls: [], callTimes: [], ...overrides };
}

const mirrorOf = (name = NAME): RemoteLaneMirror | null => lanes.get(name)?.mirror ?? null;

describe('RemoteLaneFollower (PAN-4638 WI-7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
    lanes = new Map([[NAME, { facts: facts(NAME), mirror: null, archivedAt: null }]]);
    mirrored = new Map();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ac1: one poll mirrors two reports with git and verdict, and writes lastSeq 2 and the activity', async () => {
    const own = owner({ reports: [report(1), report(2)] });
    const { follower } = harness(own);
    follower.track(NAME);
    await vi.advanceTimersByTimeAsync(0);

    expect(own.calls).toEqual([`/api/machines/work/lanes/${NAME}/status?after=0`]);
    expect(mirrored.get(`conv-${NAME}/reports/0001.json`)).toMatchObject({ git: { head: 'head1' }, verdict: { value: 'WOWED' } });
    expect(mirrored.get(`conv-${NAME}/reports/0002.json`)).toMatchObject({ git: { head: 'head2' }, verdict: { value: 'WOWED' } });
    expect(mirrorOf()).toMatchObject({ state: 'running', activity: 'working', lastSeq: 2, costUsd: 0.25, lastSeenAt: '2026-11-01T12:00:00.000Z' });

    await vi.advanceTimersByTimeAsync(FOLLOW_POLL_MS);
    expect(own.calls.at(-1)).toBe(`/api/machines/work/lanes/${NAME}/status?after=2`);
    follower.stop();
  });

  it('ac2: 404 unknown-lane marks the lane gone and stops polling', async () => {
    const own = owner({ gone: true });
    const { follower } = harness(own);
    follower.track(NAME);
    await vi.advanceTimersByTimeAsync(0);
    expect(mirrorOf()).toMatchObject({ state: 'gone', activity: 'stopped' });
    expect(follower.isTracking(NAME)).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(own.calls).toHaveLength(1);
  });

  it('ac3: failures back off 1 s, 2 s, 4 s within jitter and set unreachableSince once', async () => {
    const own = owner({ fail: true });
    const { follower } = harness(own);
    follower.track(NAME);
    await vi.advanceTimersByTimeAsync(0);
    const since = mirrorOf()?.unreachableSince;
    expect(since).toBe('2026-11-01T12:00:00.000Z');

    await vi.advanceTimersByTimeAsync(800);
    expect(own.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(own.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_400);
    expect(own.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(4_800);
    expect(own.calls).toHaveLength(4);
    const gaps = own.callTimes.slice(1).map((time, index) => time - own.callTimes[index]!);
    expect(gaps[0]).toBeGreaterThanOrEqual(800);
    expect(gaps[0]).toBeLessThanOrEqual(1_200);
    expect(gaps[1]).toBeGreaterThanOrEqual(1_600);
    expect(gaps[1]).toBeLessThanOrEqual(2_400);
    expect(gaps[2]).toBeGreaterThanOrEqual(3_200);
    expect(gaps[2]).toBeLessThanOrEqual(4_800);
    expect(mirrorOf()?.unreachableSince).toBe(since);

    own.fail = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mirrorOf()).toMatchObject({ unreachableSince: null, activity: 'working' });
    follower.stop();
  });

  it('backs off without calling while the link is offline', async () => {
    const own = owner({ online: false });
    const { follower } = harness(own);
    follower.track(NAME);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(own.calls).toHaveLength(0);
    expect(mirrorOf()?.unreachableSince).toBe('2026-11-01T12:00:00.000Z');
    follower.stop();
  });

  it('ac4: start resumes a running stand-in and skips archived and gone ones', async () => {
    lanes.set('20261101-0002', { facts: facts('20261101-0002'), mirror: { ...initialLaneMirror(), lastSeq: 3 }, archivedAt: null });
    lanes.set('20261101-0003', { facts: facts('20261101-0003'), mirror: null, archivedAt: '2026-11-01T11:00:00.000Z' });
    lanes.set('20261101-0004', { facts: facts('20261101-0004'), mirror: { ...initialLaneMirror(), state: 'gone' }, archivedAt: null });
    const own = owner();
    const { follower } = harness(own);
    await follower.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(follower.isTracking(NAME)).toBe(true);
    expect(follower.isTracking('20261101-0002')).toBe(true);
    expect(follower.isTracking('20261101-0003')).toBe(false);
    expect(follower.isTracking('20261101-0004')).toBe(false);
    expect(own.calls).toContain('/api/machines/work/lanes/20261101-0002/status?after=3');
    expect(own.calls.some((path) => path.includes('20261101-0003'))).toBe(false);
    follower.stop();
  });

  it('stops following once archived.json exists at home', async () => {
    const own = owner();
    const { follower } = harness(own);
    follower.track(NAME);
    await vi.advanceTimersByTimeAsync(0);
    lanes.set(NAME, { ...lanes.get(NAME)!, archivedAt: '2026-11-01T12:00:01.000Z' });
    await vi.advanceTimersByTimeAsync(FOLLOW_POLL_MS);
    expect(follower.isTracking(NAME)).toBe(false);
    expect(own.calls).toHaveLength(1);
  });
});

describe('RemoteLaneFollower with the real stand-in store (PAN-4638 WI-7 ac1)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-4638-lane-follower-'));
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('writes reports/0001.json and 0002.json and mirror.json on disk', async () => {
    const { writeRemoteLaneFacts, readRemoteLane } = await import('../../../lib/lanes/remote-lanes.js');
    await writeRemoteLaneFacts(facts(NAME));
    lanes = new Map();
    const own = owner({ reports: [report(1), report(2)] });
    const { deps } = harness(own);
    const follower = new RemoteLaneFollower({ ...defaultRemoteLaneFollowerDeps(() => true), fetch: deps.fetch });
    follower.track(NAME);
    await vi.waitFor(async () => expect((await readRemoteLane(NAME))?.mirror?.lastSeq).toBe(2));
    follower.stop();

    const reports = join(home, 'agents', `conv-${NAME}`, 'reports');
    expect(JSON.parse(readFileSync(join(reports, '0001.json'), 'utf8'))).toMatchObject({ seq: 1, git: { head: 'head1' }, verdict: { value: 'WOWED' } });
    expect(JSON.parse(readFileSync(join(reports, '0002.json'), 'utf8'))).toMatchObject({ seq: 2, git: { head: 'head2' } });
    expect((await readRemoteLane(NAME))?.mirror).toMatchObject({ activity: 'working', lastSeq: 2 });
  });
});
