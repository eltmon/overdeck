import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  candidates: vi.fn(), mainRuns: vi.fn(), prHead: vi.fn(), prRuns: vi.fn(), rerun: vi.fn(),
}));

vi.mock('../../../../lib/overdeck/review-status-sync.js', () => ({
  getMergeBlockerReconcileCandidates: () => Effect.succeed(mocks.candidates()),
}));
vi.mock('../../../../lib/cloister/stale-check-github.js', () => ({
  listRecentMainRuns: mocks.mainRuns,
  getPrHead: mocks.prHead,
  listPrHeadFailingRuns: mocks.prRuns,
  rerunFailedRun: mocks.rerun,
}));

import {
  __tickOnceForTests,
  startStaleCheckRetriggerService,
  stopStaleCheckRetriggerService,
} from '../stale-check-retrigger-service.js';

const candidate = (issueId = 'PAN-2710', number = 42) => ({
  issueId, prUrl: `https://github.com/eltmon/overdeck/pull/${number}`,
  blockerReasons: [{ type: 'failing_checks' }], readyForMerge: false,
});
const run = (overrides = {}) => ({
  databaseId: 10, workflowName: 'CI', createdAt: '2026-07-15T10:30:00Z',
  conclusion: 'FAILURE', status: 'completed', attempt: 1, headSha: 'sha', ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
  vi.clearAllMocks();
  mocks.candidates.mockReturnValue([candidate()]);
  mocks.mainRuns.mockResolvedValue([
    run({ createdAt: '2026-07-15T10:00:00Z' }),
    run({ createdAt: '2026-07-15T11:00:00Z', conclusion: 'SUCCESS' }),
  ]);
  mocks.prHead.mockResolvedValue({ headRefName: 'feature/pan-2710', headRefOid: 'sha' });
  mocks.prRuns.mockResolvedValue([run()]);
  mocks.rerun.mockResolvedValue(true);
});

afterEach(() => {
  stopStaleCheckRetriggerService();
  vi.useRealTimers();
});

it('reruns an inherited failure and logs its red window', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await __tickOnceForTests();
  expect(mocks.rerun).toHaveBeenCalledWith('eltmon/overdeck', 10);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('re-ran run 10 (CI) for PAN-2710 PR #42'));
  expect(log).toHaveBeenCalledWith(expect.stringContaining('2026-07-15T10:00:00Z → 2026-07-15T11:00:00Z'));
});

it('makes zero GitHub calls without failing-check candidates', async () => {
  mocks.candidates.mockReturnValue([{ ...candidate(), blockerReasons: [] }]);
  await __tickOnceForTests();
  expect(mocks.mainRuns).not.toHaveBeenCalled();
  expect(mocks.prHead).not.toHaveBeenCalled();
});

it.each([
  ['main-still-red', [run({ createdAt: '2026-07-15T10:00:00Z' })], run(), 'main-still-red'],
  ['attempt-exceeded', [run({ createdAt: '2026-07-15T10:00:00Z' }), run({ createdAt: '2026-07-15T11:00:00Z', conclusion: 'SUCCESS' })], run({ attempt: 2 }), 'attempt-exceeded'],
  ['no-red-window-match', [run({ createdAt: '2026-07-15T10:00:00Z' }), run({ createdAt: '2026-07-15T11:00:00Z', conclusion: 'SUCCESS' })], run({ createdAt: '2026-07-15T11:30:00Z' }), 'no-red-window-match'],
])('skips %s once across ticks', async (_label, mainRuns, prRun, reason) => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.mainRuns.mockResolvedValue(mainRuns);
  mocks.prRuns.mockResolvedValue([prRun]);
  await __tickOnceForTests();
  vi.advanceTimersByTime(10 * 60_000);
  await __tickOnceForTests();
  expect(mocks.rerun).not.toHaveBeenCalled();
  expect(log.mock.calls.filter(([message]) => String(message).includes(`: ${reason}`))).toHaveLength(1);
});

it('never retries an attempted run, including a failed rerun', async () => {
  mocks.rerun.mockResolvedValue(false);
  await __tickOnceForTests();
  vi.advanceTimersByTime(10 * 60_000);
  await __tickOnceForTests();
  expect(mocks.rerun).toHaveBeenCalledTimes(1);
});

it('caps reruns at five and defers the remainder', async () => {
  mocks.prRuns.mockResolvedValue(Array.from({ length: 7 }, (_, index) => run({ databaseId: index + 1 })));
  await __tickOnceForTests();
  expect(mocks.rerun).toHaveBeenCalledTimes(5);
  await __tickOnceForTests();
  expect(mocks.rerun).toHaveBeenCalledTimes(7);
});

it('throttles main probes for three minutes and issue evaluation for ten', async () => {
  await __tickOnceForTests();
  await __tickOnceForTests();
  expect(mocks.mainRuns).toHaveBeenCalledTimes(1);
  expect(mocks.prHead).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(10 * 60_000);
  await __tickOnceForTests();
  expect(mocks.mainRuns).toHaveBeenCalledTimes(2);
  expect(mocks.prHead).toHaveBeenCalledTimes(2);
});

it('swallows adapter errors and keeps the interval firing', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.mainRuns.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
  startStaleCheckRetriggerService();
  await vi.advanceTimersByTimeAsync(60_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(warn).toHaveBeenCalledWith('[stale-check-retrigger] tick failed:', 'offline');
  expect(mocks.mainRuns).toHaveBeenCalledTimes(2);
});

it('does not overlap interval ticks while an evaluation is pending', async () => {
  let resolveHead!: (head: { headRefName: string; headRefOid: string }) => void;
  mocks.prHead.mockReturnValue(new Promise((resolve) => { resolveHead = resolve; }));
  startStaleCheckRetriggerService();

  await vi.advanceTimersByTimeAsync(60_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.prHead).toHaveBeenCalledTimes(1);

  resolveHead({ headRefName: 'feature/pan-2710', headRefOid: 'sha' });
  await vi.advanceTimersByTimeAsync(0);
});

it('prunes issue throttles when candidates disappear', async () => {
  await __tickOnceForTests();
  mocks.candidates.mockReturnValue([]);
  await __tickOnceForTests();
  mocks.candidates.mockReturnValue([candidate()]);

  await __tickOnceForTests();
  expect(mocks.prHead).toHaveBeenCalledTimes(2);
  expect(mocks.rerun).toHaveBeenCalledTimes(2);
});

it('does not retry a failed rerun command after the retention window', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.rerun.mockResolvedValue(false);
  await __tickOnceForTests();

  vi.advanceTimersByTime(24 * 60 * 60_000 + 1);
  await __tickOnceForTests();

  expect(mocks.rerun).toHaveBeenCalledTimes(1);
  expect(log).not.toHaveBeenCalledWith(expect.stringContaining('skipping run 10'));
});

it('expires skip-log deduplication after its retention window', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.prRuns.mockResolvedValue([run({ attempt: 2 })]);
  await __tickOnceForTests();

  vi.advanceTimersByTime(24 * 60 * 60_000 + 1);
  await __tickOnceForTests();

  expect(log.mock.calls.filter(([message]) => String(message).includes('skipping run 10'))).toHaveLength(2);
});
