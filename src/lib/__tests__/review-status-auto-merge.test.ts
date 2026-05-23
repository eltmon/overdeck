import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { ReviewStatus } from '../review-status.js';

const mocks = vi.hoisted(() => ({
  dbStatus: undefined as ReviewStatus | undefined,
  upsert: vi.fn(),
  notifyPipeline: vi.fn(),
  emitActivity: vi.fn(),
  emitTts: vi.fn(),
  existsSync: vi.fn(() => false),
  resolveProjectFromIssue: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
}));

vi.mock('../database/review-status-db.js', async () => {
  const { Effect } = await import('effect');
  return {
    upsertReviewStatusSync: mocks.upsert,
    deleteReviewStatus: vi.fn(),
    getReviewStatusFromDbSync: vi.fn(() => mocks.dbStatus),
    getAllReviewStatusesFromDb: vi.fn(() => ({})),
    getReviewStatusesFromDb: vi.fn(() => ({})),
    markWorkspaceStuck: vi.fn(),
    clearWorkspaceStuck: vi.fn(),
    setDeaconIgnored: vi.fn(),
    getReviewStatusFromDb: vi.fn(() => Effect.succeed(mocks.dbStatus ?? null)),
  };
});

vi.mock('../pipeline-notifier.js', () => ({
  notifyPipelineSync: mocks.notifyPipeline,
}));

vi.mock('../activity-logger.js', () => ({
  emitActivityEntrySync: mocks.emitActivity,
  emitActivityTtsSync: mocks.emitTts,
}));

vi.mock('../vbrief/dag.js', () => ({
  buildPipelineMirrorFromStatus: vi.fn(),
  writePipelineMirrorToPlanFile: vi.fn(),
}));

vi.mock('../vbrief/io.js', () => ({
  findPlan: vi.fn(),
}));

vi.mock('../review-status-normalize.js', () => ({
  normalizeReviewStatusSync: (status: ReviewStatus) => status,
}));

vi.mock('../projects.js', () => ({
  resolveProjectFromIssue: mocks.resolveProjectFromIssue,
}));

import { setAutoMergeOnReadyHandler, setReviewStatusSync } from '../review-status.js';

function status(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-1418',
    reviewStatus: 'passed',
    testStatus: 'passed',
    mergeStatus: 'pending',
    updatedAt: '2026-05-23T15:20:00.000Z',
    readyForMerge: false,
    ...overrides,
  };
}

describe('review-status auto-merge ready hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAutoMergeOnReadyHandler(null);
    mocks.dbStatus = status();
    mocks.resolveProjectFromIssue.mockReturnValue(Effect.succeed({
      projectKey: 'panopticon',
      projectName: 'Panopticon',
      projectPath: '/tmp/panopticon',
      linearTeam: 'PAN',
    }));
  });

  afterEach(() => {
    setAutoMergeOnReadyHandler(null);
  });

  it('invokes the registered handler when readyForMerge transitions false to true', async () => {
    const handler = vi.fn().mockResolvedValue(false);
    setAutoMergeOnReadyHandler(handler);

    const updated = setReviewStatusSync('pan-1418', { readyForMerge: true });

    expect(updated.readyForMerge).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith('PAN-1418', 'panopticon'));
  });

  it('does not invoke the handler when readyForMerge was already true', async () => {
    const handler = vi.fn().mockResolvedValue(false);
    setAutoMergeOnReadyHandler(handler);
    mocks.dbStatus = status({ readyForMerge: true });

    setReviewStatusSync('PAN-1418', { readyForMerge: true });
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
  });

  it('continues normally when no handler is registered', async () => {
    const updated = setReviewStatusSync('PAN-1418', { readyForMerge: true });
    await Promise.resolve();

    expect(updated.readyForMerge).toBe(true);
    expect(mocks.resolveProjectFromIssue).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ readyForMerge: true }));
  });
});
