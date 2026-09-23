/**
 * PAN-3920 D16/D18: every branch of the wait, on fake timers (NFR-2). The real
 * `setTimeout`-based sleep and `Date.now` run under `vi.useFakeTimers()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LivenessVerdict } from '../../liveness.js';
import type { WorkerReport } from '../report.js';
import { waitForWorkerReport, type WaitDeps, type WaitOutcome } from '../wait.js';

const ID = 'agent-pan-9-worker-1';
const ALIVE: LivenessVerdict = { alive: true, paneAlive: true };
const DEAD: LivenessVerdict = { alive: false, reason: 'pane-dead' };

function report(seq: number, status: WorkerReport['status'] = 'done'): WorkerReport {
  return { seq, at: '2026-09-23T12:00:00.000Z', status, body: `report ${seq}` };
}

function harness(overrides: Partial<WaitDeps> & { reports?: WorkerReport[] } = {}) {
  const reports = overrides.reports ?? [];
  const deps: WaitDeps = {
    listReports: vi.fn(async () => [...reports]),
    isAlive: vi.fn(async () => ALIVE),
    idleAgeMs: vi.fn(() => 0),
    fetchLastAssistantMessage: vi.fn(async () => 'last words'),
    resolveTranscriptPath: vi.fn(async () => '/tmp/transcript.jsonl'),
    ...overrides,
  };
  return { deps, reports };
}

async function settle(promise: Promise<WaitOutcome>, advanceMs: number): Promise<WaitOutcome | 'pending'> {
  let outcome: WaitOutcome | 'pending' = 'pending';
  void promise.then((value) => { outcome = value; });
  await vi.advanceTimersByTimeAsync(advanceMs);
  return outcome;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForWorkerReport', () => {
  it('returns the report that appears after three polls', async () => {
    const { deps, reports } = harness();
    const promise = waitForWorkerReport(ID, { afterSeq: 0 }, deps);
    expect(await settle(promise, 4_000)).toBe('pending');
    reports.push(report(1));
    expect(await settle(promise, 2_000)).toEqual({ kind: 'report', report: report(1) });
    expect((deps.listReports as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('ignores reports at or below afterSeq', async () => {
    const { deps, reports } = harness({ reports: [report(1)] });
    const promise = waitForWorkerReport(ID, { afterSeq: 1 }, deps);
    expect(await settle(promise, 6_000)).toBe('pending');
    reports.push(report(2, 'blocked'));
    expect(await settle(promise, 2_000)).toEqual({ kind: 'report', report: report(2, 'blocked') });
  });

  it('without afterSeq returns the newest existing report at once', async () => {
    const { deps } = harness({ reports: [report(1), report(2)] });
    expect(await settle(waitForWorkerReport(ID, {}, deps), 0)).toMatchObject({ kind: 'report', report: { seq: 2 } });
  });

  it('with afterSeq returns the next unconsumed report, not the newest', async () => {
    const { deps } = harness({ reports: [report(1), report(2), report(3)] });
    expect(await settle(waitForWorkerReport(ID, { afterSeq: 1 }, deps), 0)).toMatchObject({ kind: 'report', report: { seq: 2 } });
  });

  it('never misses a report written between a timed-out wait and the next wait', async () => {
    const { deps, reports } = harness();
    expect(await settle(waitForWorkerReport(ID, { timeoutMs: 5_000 }, deps), 5_000)).toEqual({ kind: 'timeout' });

    // The worker reports one second after the first wait gave up.
    await vi.advanceTimersByTimeAsync(1_000);
    reports.push(report(1));

    expect(await settle(waitForWorkerReport(ID, { timeoutMs: 5_000 }, deps), 0)).toEqual({ kind: 'report', report: report(1) });
    // A looping caller passes the seq it consumed; the same report is not returned twice.
    expect(await settle(waitForWorkerReport(ID, { afterSeq: 1, timeoutMs: 5_000 }, deps), 5_000)).toEqual({ kind: 'timeout' });
  });

  it('returns exited-without-report with the last assistant message on a confirmed death', async () => {
    let calls = 0;
    const { deps } = harness({ isAlive: vi.fn(async () => (calls++ < 2 ? ALIVE : DEAD)) });
    const outcome = await settle(waitForWorkerReport(ID, { afterSeq: 0 }, deps), 6_000);
    expect(outcome).toEqual({ kind: 'exited-without-report', lastAssistantMessage: 'last words', transcriptPath: null });
  });

  it('does not call a never-seen-alive worker dead inside the startup grace', async () => {
    const { deps } = harness({ isAlive: vi.fn(async () => ({ alive: false, reason: 'runtime-missing' }) as LivenessVerdict) });
    const promise = waitForWorkerReport(ID, { afterSeq: 0 }, deps);
    expect(await settle(promise, 58_000)).toBe('pending');
    expect(await settle(promise, 4_000)).toMatchObject({ kind: 'exited-without-report' });
  });

  it('treats an indeterminate probe as not dead', async () => {
    const { deps } = harness({ isAlive: vi.fn(async () => ({ alive: false, reason: 'runtime-indeterminate' }) as LivenessVerdict) });
    const promise = waitForWorkerReport(ID, { afterSeq: 0, timeoutMs: 120_000 }, deps);
    expect(await settle(promise, 90_000)).toBe('pending');
    expect(await settle(promise, 40_000)).toEqual({ kind: 'timeout' });
  });

  it('returns idle-without-report after 601 s of reportless idleness and leaves the worker running', async () => {
    const { deps } = harness({ idleAgeMs: vi.fn(() => 601_000) });
    const promise = waitForWorkerReport(ID, { afterSeq: 0 }, deps);
    expect(await settle(promise, 30_000)).toBe('pending');
    expect(await settle(promise, 32_000)).toEqual({
      kind: 'idle-without-report',
      lastAssistantMessage: 'last words',
      transcriptPath: null,
    });
  });

  it('times out at the deadline', async () => {
    const { deps } = harness();
    const promise = waitForWorkerReport(ID, { afterSeq: 0, timeoutMs: 5_000 }, deps);
    expect(await settle(promise, 4_000)).toBe('pending');
    expect(await settle(promise, 1_000)).toEqual({ kind: 'timeout' });
  });

  it('falls back to the transcript path when the dashboard fetch fails', async () => {
    const { deps } = harness({
      isAlive: vi.fn(async () => DEAD),
      fetchLastAssistantMessage: vi.fn(async () => { throw new Error('ECONNREFUSED'); }),
    });
    const outcome = await settle(waitForWorkerReport(ID, { afterSeq: 0, startupGraceMs: 0 }, deps), 1_000);
    expect(outcome).toEqual({
      kind: 'exited-without-report',
      lastAssistantMessage: null,
      transcriptPath: '/tmp/transcript.jsonl',
    });
  });

  it('prefers a report written just before the worker exited', async () => {
    let polls = 0;
    const reports: WorkerReport[] = [];
    const { deps } = harness({
      listReports: vi.fn(async () => {
        polls += 1;
        // The report lands between the report poll and the liveness check.
        if (polls === 2) reports.push(report(1));
        return [...reports];
      }),
      isAlive: vi.fn(async () => DEAD),
    });
    const outcome = await settle(waitForWorkerReport(ID, { afterSeq: 0, startupGraceMs: 0 }, deps), 1_000);
    expect(outcome).toEqual({ kind: 'report', report: report(1) });
  });
});
