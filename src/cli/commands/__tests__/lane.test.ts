/**
 * PAN-4223 WI-8: `pan lane` with an injected fetch, lane resolver, lane cores
 * and fake time. The live dashboard is never called.
 */
import { describe, expect, it, vi } from 'vitest';

import type { WaitOutcome } from '../../../lib/agents/worker/wait.js';
import {
  laneListCommand,
  laneReapCommand,
  laneStartCommand,
  laneWaitCommand,
  MISSING_LANE_PARENT_MESSAGE,
  type LaneCliDeps,
} from '../lane.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const LAUNCHED = {
  conversation: { id: 42, name: 'brisk-otter', gauntletRun: 'hotel', laneKey: '663', laneRole: 'builder' },
  cwd: '/home/u/Projects/lexerra-lanes/hotel-663',
  branch: 'hotel/663',
  iteration: 1,
  warnings: [],
};

function harness(overrides: Partial<LaneCliDeps> = {}) {
  let now = 0;
  const out: string[] = [];
  const err: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void url;
    void init;
    return json(201, LAUNCHED);
  });
  const deps: LaneCliDeps = {
    fetch: fetchMock,
    apiUrl: () => 'http://localhost:3011',
    env: {},
    readFile: vi.fn(async () => '# brief from file'),
    readStdin: vi.fn(async () => ''),
    resolveLane: vi.fn(async (ref: string) => ({ id: 42, name: ref.replace(/^conv-/, ''), run: 'hotel', key: '663', spawnError: null })),
    waitForLane: vi.fn(async (): Promise<WaitOutcome> => ({ kind: 'timeout' })),
    waitForLaneSet: vi.fn(async () => ({ kind: 'timeout' as const, cursor: '' })),
    reportLane: vi.fn(async () => 'lane hotel/663 report 1: done'),
    now: () => now,
    sleep: vi.fn(async (ms: number) => { now += ms; }),
    stdout: (text) => { out.push(text); },
    stderr: (text) => { err.push(text); },
    ...overrides,
  };
  return { deps, fetchMock, out, err };
}

function sentBody(fetchMock: ReturnType<typeof harness>['fetchMock'], call = 0): unknown {
  const init = fetchMock.mock.calls[call]?.[1];
  return init?.body ? JSON.parse(String(init.body)) : undefined;
}

describe('pan lane start', () => {
  it('exits 1 with the D5 message without --parent or $OVERDECK_CONVERSATION', async () => {
    const { deps, fetchMock, err } = harness();
    expect(await laneStartCommand({ key: '663', role: 'builder', prompt: 'go', run: 'hotel' }, deps)).toBe(1);
    expect(err).toEqual([MISSING_LANE_PARENT_MESSAGE]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('strips conv- from $OVERDECK_CONVERSATION, posts with an Origin, and prints the lane line', async () => {
    const { deps, fetchMock, out } = harness({ env: { OVERDECK_CONVERSATION: 'conv-abc' } });
    const code = await laneStartCommand({ key: '663', role: 'builder', brief: '/b/663.md', run: 'hotel', wait: false }, deps);
    expect(code).toBe(0);
    expect(sentBody(fetchMock)).toEqual({ parent: 'abc', key: '663', role: 'builder', brief: '# brief from file', briefSource: '/b/663.md', run: 'hotel' });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Origin: 'http://localhost:3011' });
    expect(out).toEqual(['Lane hotel/663 builder i1: conv 42 (brisk-otter) in /home/u/Projects/lexerra-lanes/hotel-663']);
  });

  it('exits 1 when both --brief and --prompt are given', async () => {
    const { deps, fetchMock } = harness({ env: { OVERDECK_CONVERSATION: 'conv-abc' } });
    expect(await laneStartCommand({ key: '663', role: 'builder', brief: '/b.md', prompt: 'go' }, deps)).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prints a 409 error and exits 1', async () => {
    const { deps, err } = harness({ env: { OVERDECK_CONVERSATION: 'conv-abc' } });
    (deps.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(json(409, { error: 'lane hotel/663 builder is live as conversation #7 (x)' }));
    expect(await laneStartCommand({ key: '663', role: 'builder', prompt: 'go', run: 'hotel' }, deps)).toBe(1);
    expect(err).toEqual(['lane hotel/663 builder is live as conversation #7 (x)']);
  });

  it('waits until the lane leaves starting, and exits 1 with the spawn error when it fails to start', async () => {
    const started = harness({ env: { OVERDECK_CONVERSATION: 'conv-abc' } });
    const fetchStarted = started.deps.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchStarted.mockResolvedValueOnce(json(201, LAUNCHED))
      .mockResolvedValueOnce(json(200, { activity: 'starting' }))
      .mockResolvedValueOnce(json(200, { activity: 'working' }));
    expect(await laneStartCommand({ key: '663', role: 'builder', prompt: 'go', run: 'hotel' }, started.deps)).toBe(0);
    expect(started.deps.sleep).toHaveBeenCalledTimes(1);

    const failed = harness({
      env: { OVERDECK_CONVERSATION: 'conv-abc' },
      resolveLane: vi.fn(async () => ({ id: 42, name: 'brisk-otter', run: 'hotel', key: '663', spawnError: 'codex not installed' })),
    });
    (failed.deps.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(json(201, LAUNCHED)).mockResolvedValueOnce(json(200, { activity: 'failed-to-start' }));
    expect(await laneStartCommand({ key: '663', role: 'builder', prompt: 'go', run: 'hotel' }, failed.deps)).toBe(1);
    expect(failed.err.at(-1)).toContain('codex not installed');
  });
});

describe('pan lane wait', () => {
  const REPORT = { seq: 3, at: '2026-09-26T12:00:00.000Z', body: '# result' };
  it.each([
    [{ kind: 'report', report: { ...REPORT, status: 'done' } }, 0],
    [{ kind: 'report', report: { ...REPORT, status: 'blocked' } }, 4],
    [{ kind: 'report', report: { ...REPORT, status: 'failed' } }, 4],
    [{ kind: 'exited-without-report', lastAssistantMessage: 'bye', transcriptPath: null }, 2],
    [{ kind: 'timeout' }, 3],
  ] as Array<[WaitOutcome, number]>)('maps %j to exit %i', async (outcome, code) => {
    const { deps } = harness({ waitForLane: vi.fn(async () => outcome) });
    expect(await laneWaitCommand('conv-brisk-otter', {}, deps)).toBe(code);
    expect(deps.waitForLane).toHaveBeenCalledWith('brisk-otter', { afterSeq: undefined, timeoutMs: null });
  });

  it('prints the next cursor for a run wait, and exits 3 on timeout with the same cursor', async () => {
    const report = { kind: 'report' as const, lane: { name: 'brisk-otter', run: 'hotel', key: '663', activity: 'idle' as const, lastActivityAt: null }, report: { ...REPORT, status: 'done' as const }, cursor: '1790000000000.brisk-otter.3' };
    const first = harness({ waitForLaneSet: vi.fn(async () => report) });
    expect(await laneWaitCommand(undefined, { run: 'hotel' }, first.deps)).toBe(0);
    expect(first.out).toEqual(['# result']);
    expect(first.err).toEqual(['lane hotel/663 (brisk-otter) report 3: done; next: pan lane wait --run hotel --after 1790000000000.brisk-otter.3']);

    const idle = harness({ waitForLaneSet: vi.fn(async () => ({ kind: 'timeout' as const, cursor: report.cursor })) });
    expect(await laneWaitCommand(undefined, { run: 'hotel', after: report.cursor, timeout: '5' }, idle.deps)).toBe(3);
    expect(idle.err).toEqual([`no new lane report; next: pan lane wait --run hotel --after ${report.cursor}`]);
  });
});

describe('pan lane reap and list', () => {
  it('sends park and keep false by default and keep true with --keep', async () => {
    const { deps, fetchMock } = harness();
    fetchMock.mockImplementation(async () => json(200, { removed: true, archived: true, parkedPatch: null, warnings: [] }));
    expect(await laneReapCommand('brisk-otter', {}, deps)).toBe(0);
    expect(sentBody(fetchMock, 0)).toEqual({ park: false, keep: false });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://localhost:3011/api/lanes/brisk-otter/reap');
    expect(await laneReapCommand('brisk-otter', { keep: true }, deps)).toBe(0);
    expect(sentBody(fetchMock, 1)).toEqual({ park: false, keep: true });
  });

  it('prints the archive warning and exits 0 when archiving failed', async () => {
    const warning = 'reaped, but archiving failed: Internal server error; archive conv 42 from the Command Deck';
    const { deps, fetchMock, out, err } = harness();
    fetchMock.mockResolvedValue(json(200, { removed: true, archived: false, parkedPatch: null, warnings: [warning] }));
    expect(await laneReapCommand('brisk-otter', {}, deps)).toBe(0);
    expect(out).toEqual(['Reaped lane hotel/663 (conv 42): directory removed, conversation not archived']);
    expect(err).toEqual([`warning: ${warning}`]);
  });

  it('shows archived in ACTIVITY for an archived lane', async () => {
    const lane = {
      id: 42, name: 'brisk-otter', run: 'hotel', key: '663', role: 'builder', iteration: 2, activity: 'stopped', archived: true,
      report: { seq: 1, status: 'done' }, git: null, model: 'claude-opus-5-5', costUsd: 1.5,
    };
    const { deps, fetchMock, out } = harness();
    fetchMock.mockResolvedValue(json(200, { generatedAt: 'now', lanes: [lane] }));
    expect(await laneListCommand({ run: 'hotel' }, deps)).toBe(0);
    expect(out[0]).toMatch(/^ID\s+RUN\/KEY\s+ROLE\s+ITER\s+ACTIVITY\s+REPORT\s+BRANCH@SHA\s+AHEAD\s+DIRTY\s+MODEL\s+COST$/);
    expect(out[1]).toMatch(/^42\s+hotel\/663\s+builder\s+2\s+archived\s+#1 done\s+-\s+-\s+-\s+claude-opus-5-5\s+\$1\.50$/);
  });
});
