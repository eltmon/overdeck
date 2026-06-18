import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase } from '../../database/index.js';
import { getPendingAutoMergePayload, postAutoMergeSchedulePayload, deleteAutoMergePayload } from '../../../dashboard/server/routes/flywheel.js';
import { tickAutoMergeExecutor } from '../../../dashboard/server/services/auto-merge-executor.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../tests/helpers/overdeck-test-db.js';
import { getOverdeckDatabaseSync } from '../../overdeck/infra.js';
import type { PendingAutoMerge } from '../../database/pending-auto-merges-db.js';

interface RawMergeRow {
  id: number; issue_id: string; pr_url: string; project_key: string; forge: string;
  status: string; scheduled_merge_at: number; scheduled_at: number;
  merged_at: number | null; failure_reason: string | null;
  cancelled_at: number | null; cancelled_by: string | null;
}

function isoFromMs(ms: number | null): string | undefined {
  return ms == null ? undefined : new Date(ms).toISOString();
}

/** Read all rows from pending_auto_merges — drop-in for the old listPendingAutoMerges. */
function listPendingAutoMerges(): PendingAutoMerge[] {
  const db = getOverdeckDatabaseSync();
  const rows = db.prepare('SELECT * FROM pending_auto_merges ORDER BY scheduled_merge_at ASC, id ASC').all() as RawMergeRow[];
  return rows.map(row => ({
    id: row.id,
    issueId: row.issue_id,
    prUrl: row.pr_url,
    projectKey: row.project_key,
    forge: row.forge as PendingAutoMerge['forge'],
    status: row.status as PendingAutoMerge['status'],
    scheduledMergeAt: new Date(row.scheduled_merge_at).toISOString(),
    scheduledAt: new Date(row.scheduled_at).toISOString(),
    mergedAt: isoFromMs(row.merged_at),
    failureReason: row.failure_reason ?? undefined,
    cancelledAt: isoFromMs(row.cancelled_at),
    cancelledBy: row.cancelled_by ?? undefined,
  }));
}

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
    resolveProject: () => ({ projectKey: 'panopticon-cli', projectPath: process.cwd(), projectName: 'Overdeck CLI' }) as never,
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

async function advanceFakeTimers(ms: number): Promise<void> {
  const started = Date.now();
  await vi.advanceTimersByTimeAsync(ms);
  expect(Date.now() - started).toBe(ms);
}

describe('auto-merge schedule/cancel/executor integration', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    resetDatabase();
    odb = setupOverdeckTestDb();
    // Seed the issue row that pending_auto_merges FK requires
    odb.raw().prepare(
      `INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, 'pending', ?)`,
    ).run('PAN-1486', Date.now());
  });

  afterEach(() => {
    resetDatabase();
    teardownOverdeckTestDb(odb);
    vi.useRealTimers();
  });

  it('cancels during cooldown and never invokes merge after expiry', async () => {
    const mergeIssue = vi.fn();

    await scheduleAutoMerge();
    await advanceFakeTimers(4 * 60_000);

    expect(deleteAutoMergePayload('PAN-1486', { now: () => new Date(Date.now()), announce: vi.fn() })).toMatchObject({
      status: 200,
      body: { issueId: 'PAN-1486', status: 'cancelled', cancelledBy: 'operator' },
    });
    expect(getPendingAutoMergePayload()).toEqual([]);

    await advanceFakeTimers(60_000);
    await tickWith({ mergeIssue });

    expect(mergeIssue).not.toHaveBeenCalled();
    expect(listPendingAutoMerges()).toHaveLength(1);
    expect(listPendingAutoMerges()[0]).toMatchObject({ issueId: 'PAN-1486', status: 'cancelled' });
  });

  it('fires one merge after the cooldown expires and records merged state', async () => {
    const mergeIssue = vi.fn().mockResolvedValue({ success: true, statusCode: 200, message: 'Merged', mergeStatus: 'merged' });

    await scheduleAutoMerge();
    await advanceFakeTimers(5 * 60_000);
    await tickWith({ isEligible: async () => ({ eligible: true }), mergeIssue });

    expect(mergeIssue).toHaveBeenCalledTimes(1);
    expect(mergeIssue).toHaveBeenCalledWith('PAN-1486');
    expect(listPendingAutoMerges()).toHaveLength(1);
    expect(listPendingAutoMerges()[0]).toMatchObject({ issueId: 'PAN-1486', status: 'merged' });
  });

  it('blocks instead of merging when eligibility flips red during cooldown', async () => {
    const mergeIssue = vi.fn();

    await scheduleAutoMerge();
    await advanceFakeTimers(5 * 60_000);
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
  });
});
