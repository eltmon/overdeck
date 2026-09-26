/**
 * PAN-4223 WI-6 step 4: lane waits with an injected clock and sleep (no real
 * timers), injected report lists, liveness and lane views.
 */
import { describe, expect, it, vi } from 'vitest';

import type { WorkerReport } from '../../agents/worker/report.js';
import { laneCursor, waitForLane, waitForLaneSet, type LaneWaitView } from '../wait.js';

function clock(start = Date.parse('2026-09-26T12:00:00.000Z')) {
  let current = start;
  return {
    now: () => current,
    sleep: vi.fn(async (ms: number) => { current += ms; }),
  };
}

function report(seq: number, at: string, status: WorkerReport['status'] = 'done'): WorkerReport {
  return { seq, at, status, body: `report ${seq}` };
}

function lane(name: string, activity: LaneWaitView['activity'] = 'working'): LaneWaitView {
  return { name, run: 'hotel', key: name, activity, lastActivityAt: null };
}

describe('waitForLane', () => {
  it('returns the report a lane writes', async () => {
    const time = clock();
    const reports: WorkerReport[] = [];
    const listReports = vi.fn(async (id: string) => {
      expect(id).toBe('conv-lane-a');
      if (time.now() - Date.parse('2026-09-26T12:00:00.000Z') >= 4_000) reports.push(report(1, '2026-09-26T12:00:04.000Z'));
      return [...reports];
    });
    const outcome = await waitForLane('lane-a', {}, {
      ...time,
      listReports,
      harnessAlive: async () => true,
      fetchLane: async () => lane('lane-a'),
    });
    expect(outcome).toMatchObject({ kind: 'report', report: { seq: 1, status: 'done' } });
  });

  it('returns exited-without-report when the harness dies after the startup grace', async () => {
    const time = clock();
    const outcome = await waitForLane('lane-b', {}, {
      ...time,
      listReports: async () => [],
      harnessAlive: async () => false,
      fetchLane: async () => lane('lane-b', 'stopped'),
      fetchLastAssistantMessage: async () => 'I stopped here',
      resolveTranscriptPath: async () => null,
    });
    expect(outcome).toEqual({ kind: 'exited-without-report', lastAssistantMessage: 'I stopped here', transcriptPath: null });
    expect(time.now() - Date.parse('2026-09-26T12:00:00.000Z')).toBeGreaterThanOrEqual(60_000);
  });

  it('counts a working lane as never idle, and an idle one from its last activity', async () => {
    const time = clock();
    const view = { ...lane('lane-c', 'idle'), lastActivityAt: new Date(time.now() - 11 * 60_000).toISOString() };
    const outcome = await waitForLane('lane-c', {}, {
      ...time,
      listReports: async () => [],
      harnessAlive: async () => true,
      fetchLane: async () => view,
      fetchLastAssistantMessage: async () => null,
      resolveTranscriptPath: async () => '/t/lane-c.jsonl',
    });
    expect(outcome).toEqual({ kind: 'idle-without-report', lastAssistantMessage: null, transcriptPath: '/t/lane-c.jsonl' });
  });
});

describe('waitForLaneSet', () => {
  const REPORTS: Record<string, WorkerReport[]> = {
    'conv-b-lane': [report(1, '2026-09-26T12:00:05.000Z')],
    'conv-a-lane': [report(1, '2026-09-26T12:00:05.000Z'), report(2, '2026-09-26T12:00:09.000Z', 'blocked')],
  };
  const deps = () => ({
    ...clock(),
    listLanes: vi.fn(async () => [lane('b-lane'), lane('a-lane')]),
    listReports: vi.fn(async (id: string) => REPORTS[id] ?? []),
    warn: vi.fn(),
  });

  it('returns reports oldest first across calls, ties on at by name then seq, each with the next cursor', async () => {
    const injected = deps();
    const seen: string[] = [];
    let after: string | undefined;
    for (let call = 0; call < 3; call += 1) {
      const outcome = await waitForLaneSet({ run: 'hotel' }, { after, timeoutMs: 10_000 }, injected);
      if (outcome.kind !== 'report') throw new Error(`expected a report, got ${outcome.kind}`);
      seen.push(`${outcome.lane.name}#${outcome.report.seq}`);
      expect(outcome.cursor).toBe(laneCursor(outcome.lane.name, outcome.report));
      after = outcome.cursor;
    }
    expect(seen).toEqual(['a-lane#1', 'b-lane#1', 'a-lane#2']);
    expect(after).toBe(`${Date.parse('2026-09-26T12:00:09.000Z')}.a-lane.2`);
  });

  it('times out with the input cursor when nothing new arrives', async () => {
    const injected = deps();
    const after = `${Date.parse('2026-09-26T12:00:09.000Z')}.a-lane.2`;
    const outcome = await waitForLaneSet({ run: 'hotel' }, { after, timeoutMs: 6_000 }, injected);
    expect(outcome).toEqual({ kind: 'timeout', cursor: after });
    expect(injected.sleep).toHaveBeenCalledTimes(3);
  });

  it('warns once per call about a stopped lane with no report since the cursor', async () => {
    const injected = { ...deps(), listLanes: vi.fn(async () => [lane('dead-lane', 'stopped')]) };
    const outcome = await waitForLaneSet({ parent: 'root-1' }, { timeoutMs: 6_000 }, injected);
    expect(outcome).toEqual({ kind: 'timeout', cursor: '' });
    expect(injected.warn).toHaveBeenCalledTimes(1);
    expect(injected.warn).toHaveBeenCalledWith('lane hotel/dead-lane (dead-lane) is stopped with no report since the cursor');
  });

  it('rejects a set without run or parent, and a malformed cursor', async () => {
    await expect(waitForLaneSet({}, {}, deps())).rejects.toThrow('--run or --parent');
    await expect(waitForLaneSet({ run: 'hotel' }, { after: 'nonsense' }, deps())).rejects.toThrow('invalid cursor');
  });
});
