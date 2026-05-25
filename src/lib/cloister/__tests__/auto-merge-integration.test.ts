import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase } from '../../database/index.js';
import { getPendingAutoMergePayload, postAutoMergeSchedulePayload, deleteAutoMergePayload } from '../../../dashboard/server/routes/flywheel.js';
import { tickAutoMergeExecutor } from '../../../dashboard/server/services/auto-merge-executor.js';
import { listPendingAutoMerges } from '../../database/pending-auto-merges-db.js';

const START = new Date('2026-05-25T10:00:00.000Z');
const PR_URL = 'https://github.com/eltmon/panopticon-cli/pull/1486';

function scheduleDeps(isEligible = async () => ({ eligible: true as const })) {
  return {
    now: () => new Date(Date.now()),
    isRequireUatBeforeMerge: () => false,
    isFlywheelPaused: () => false,
    resolveLiveRunId: async () => 'RUN-7',
    isEligible,
    getReviewStatus: () => ({
      issueId: 'PAN-1486',
      reviewStatus: 'passed' as const,
      testStatus: 'passed' as const,
      mergeStatus: 'pending' as const,
      updatedAt: START.toISOString(),
      readyForMerge: true,
      prUrl: PR_URL,
    }),
    resolveProject: () => ({ projectKey: 'panopticon-cli', projectPath: process.cwd(), projectName: 'Panopticon CLI' }) as never,
    announce: vi.fn(),
  };
}

async function scheduleAutoMerge() {
  const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-1486' }, scheduleDeps());
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({
    issueId: 'PAN-1486',
    status: 'pending',
    scheduledAt: '2026-05-25T10:00:00.000Z',
    scheduledMergeAt: '2026-05-25T10:05:00.000Z',
  });
  return result.body;
}

async function tickWith(overrides: Partial<Parameters<typeof tickAutoMergeExecutor>[0]> = {}) {
  await tickAutoMergeExecutor({
    now: () => new Date(Date.now()),
    isPaused: () => false,
    announceFailure: vi.fn(),
    log: vi.fn(),
    ...overrides,
  });
}

function realElapsedMs(started: number): number {
  return vi.getRealSystemTime() - started;
}

describe('auto-merge schedule/cancel/executor integration', () => {
  const originalHome = process.env.PANOPTICON_HOME;
  let testHome: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    resetDatabase();
    testHome = join(tmpdir(), `pan-auto-merge-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.PANOPTICON_HOME = testHome;
  });

  afterEach(() => {
    resetDatabase();
    if (originalHome === undefined) {
      delete process.env.PANOPTICON_HOME;
    } else {
      process.env.PANOPTICON_HOME = originalHome;
    }
    rmSync(testHome, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('cancels during cooldown and never invokes merge after expiry', async () => {
    const started = vi.getRealSystemTime();
    const mergeIssue = vi.fn();

    await scheduleAutoMerge();
    await vi.advanceTimersByTimeAsync(4 * 60_000);

    expect(deleteAutoMergePayload('PAN-1486', { now: () => new Date(Date.now()), announce: vi.fn() })).toMatchObject({
      status: 200,
      body: { issueId: 'PAN-1486', status: 'cancelled', cancelledBy: 'operator' },
    });
    expect(getPendingAutoMergePayload()).toEqual([]);

    await vi.advanceTimersByTimeAsync(60_000);
    await tickWith({ mergeIssue });

    expect(mergeIssue).not.toHaveBeenCalled();
    expect(listPendingAutoMerges()).toHaveLength(1);
    expect(listPendingAutoMerges()[0]).toMatchObject({ issueId: 'PAN-1486', status: 'cancelled' });
    expect(realElapsedMs(started)).toBeLessThan(100);
  });

  it('fires one merge after the cooldown expires and records merged state', async () => {
    const started = vi.getRealSystemTime();
    const mergeIssue = vi.fn().mockResolvedValue({ success: true, statusCode: 200, message: 'Merged' });

    await scheduleAutoMerge();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await tickWith({ isEligible: async () => ({ eligible: true }), mergeIssue });

    expect(mergeIssue).toHaveBeenCalledTimes(1);
    expect(mergeIssue).toHaveBeenCalledWith('PAN-1486');
    expect(listPendingAutoMerges()).toHaveLength(1);
    expect(listPendingAutoMerges()[0]).toMatchObject({ issueId: 'PAN-1486', status: 'merged' });
    expect(realElapsedMs(started)).toBeLessThan(100);
  });

  it('blocks instead of merging when eligibility flips red during cooldown', async () => {
    const started = vi.getRealSystemTime();
    const mergeIssue = vi.fn();

    await scheduleAutoMerge();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await tickWith({
      isEligible: async () => ({ eligible: false, reason: 'CI checks failing on PR HEAD deadbeef' }),
      mergeIssue,
    });

    expect(mergeIssue).not.toHaveBeenCalled();
    expect(listPendingAutoMerges()).toHaveLength(1);
    expect(listPendingAutoMerges()[0]).toMatchObject({
      issueId: 'PAN-1486',
      status: 'blocked',
      failureReason: 'CI checks failing on PR HEAD deadbeef',
    });
    expect(realElapsedMs(started)).toBeLessThan(100);
  });
});
