import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';
import { upsertReviewStatusSync } from '../../../src/lib/overdeck/review-status-sync.js';

const sideEffectMocks = vi.hoisted(() => {
  const exec = vi.fn();
  Object.defineProperty(exec, Symbol.for('nodejs.util.promisify.custom'), {
    value: vi.fn(async () => ({ stdout: 'deadbeef\n', stderr: '' })),
  });
  return {
    exec,
    reportCommitStatus: vi.fn(async () => undefined),
  };
});

vi.mock('../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(), notifyPipelineSync: vi.fn(),
}));
vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(), emitActivityEntrySync: vi.fn(), emitActivityTts: vi.fn(), emitActivityTtsSync: vi.fn(),
}));
vi.mock('../../../src/lib/github-app.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/lib/github-app.js')>(),
  isGitHubAppConfigured: vi.fn(() => true),
  getPullRequestState: vi.fn(() => Effect.succeed({ state: 'CLOSED', merged: false })),
  reportCommitStatus: sideEffectMocks.reportCommitStatus,
}));
vi.mock('../../../src/lib/overdeck/review-status-record-sync.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/lib/overdeck/review-status-record-sync.js')>(),
  updateIssueRecordForReviewStatusSync: vi.fn(),
}));
vi.mock('../../../src/lib/telemetry/pipeline.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/lib/telemetry/pipeline.js')>(),
  capturePipelineStageForIssue: vi.fn(),
}));
vi.mock('child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('child_process')>(),
  exec: sideEffectMocks.exec,
}));

import { reconcileClosedPrReadyForMerge } from '../../../src/lib/cloister/deacon-merge.js';
import {
  getReviewStatusSync,
  loadReadyForMergeFlags,
  mergeGateEligibility,
  resetPipelineVerdictsForWorkStartSync,
  setReviewStatusSync,
} from '../../../src/lib/review-status.js';

let odb: OverdeckTestDb;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-16T15:00:00Z'));
  odb = setupOverdeckTestDb();
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  vi.useRealTimers();
});

function seed(issueId = 'PAN-3753') {
  // This is fixture state, not the behavior under test. Seed the cache directly
  // so setup cannot launch journal, telemetry, or GitHub publication work.
  upsertReviewStatusSync({
    issueId,
    reviewStatus: 'passed',
    testStatus: 'passed',
    verificationStatus: 'passed',
    mergeStatus: 'pending',
    readyForMerge: true,
    prNumber: 1679,
    prUrl: 'https://github.com/eltmon/overdeck/pull/1679',
    updatedAt: new Date().toISOString(),
  });
}

describe('review-status retirement', () => {
  it('retires a closed-unmerged PR without replacing its merge status', async () => {
    seed();

    expect(await reconcileClosedPrReadyForMerge()).toHaveLength(1);
    expect(getReviewStatusSync('PAN-3753')).toMatchObject({
      readyForMerge: false,
      mergeStatus: 'pending',
      retiredAt: '2026-08-16T15:00:00.000Z',
    });
  });

  it('persists retirement, rejects the record at the merge gate, and keeps it for same-PR echoes', () => {
    seed('PAN-4000');
    setReviewStatusSync('PAN-4000', { retiredAt: '2026-08-16T15:00:00.000Z', readyForMerge: false });

    setReviewStatusSync('PAN-4000', { prNumber: 1679, prUrl: 'https://github.com/eltmon/overdeck/pull/1679' });
    const retired = getReviewStatusSync('PAN-4000')!;
    expect(retired.retiredAt).toBe('2026-08-16T15:00:00.000Z');
    expect(mergeGateEligibility(retired)).toEqual({ eligible: false, reason: 'retired' });
    expect(loadReadyForMergeFlags(['PAN-4000']).get('PAN-4000')).toBe(false);
  });

  it('clears retirement for a new PR identity or an explicit work restart without leaking status publication', async () => {
    seed('PAN-4001');
    setReviewStatusSync('PAN-4001', { retiredAt: '2026-08-16T15:00:00.000Z', readyForMerge: false });
    setReviewStatusSync('PAN-4001', {
      prNumber: 1680,
      prUrl: 'https://github.com/eltmon/overdeck/pull/1680',
      readyForMerge: false,
    });
    expect(getReviewStatusSync('PAN-4001')?.retiredAt).toBeUndefined();

    setReviewStatusSync('PAN-4001', { retiredAt: '2026-08-16T15:00:00.000Z', readyForMerge: false });
    resetPipelineVerdictsForWorkStartSync('PAN-4001', { force: true });
    expect(getReviewStatusSync('PAN-4001')?.retiredAt).toBeUndefined();

    await vi.dynamicImportSettled();
    expect(sideEffectMocks.exec).not.toHaveBeenCalled();
    expect(sideEffectMocks.reportCommitStatus).not.toHaveBeenCalled();
  });
});
