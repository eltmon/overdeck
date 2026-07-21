import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectConfig } from '../projects.js';

const mocks = vi.hoisted(() => ({
  dbDelete: vi.fn(),
  dbGet: vi.fn(),
  dbUpsert: vi.fn(),
  project: undefined as ProjectConfig | undefined,
  queueAutoCommit: vi.fn(),
}));

vi.mock('../overdeck/review-status-sync.js', () => ({
  upsertReviewStatusSync: mocks.dbUpsert,
  getReviewStatusFromDbSync: mocks.dbGet,
  deleteReviewStatus: mocks.dbDelete,
  getAllReviewStatusesFromDb: vi.fn(() => ({})),
  getReviewStatusesFromDb: vi.fn(() => ({})),
  markWorkspaceStuck: vi.fn(),
  clearWorkspaceStuck: vi.fn(),
  setDeaconIgnored: vi.fn(),
  setAutoMerge: vi.fn(),
}));

vi.mock('../projects.js', async () => {
  const actual = await vi.importActual<typeof import('../projects.js')>('../projects.js');
  return {
    ...actual,
    resolveProjectFromIssueSync: vi.fn(() => mocks.project
      ? { projectKey: 'overdeck', projectPath: mocks.project.path }
      : null),
    getProjectSync: vi.fn(() => mocks.project ?? null),
  };
});

vi.mock('../pan-dir/auto-commit.js', () => ({
  queueAutoCommit: mocks.queueAutoCommit,
}));

vi.mock('../pipeline-notifier.js', () => ({
  notifyPipelineSync: vi.fn(),
}));

vi.mock('../activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

import { readIssueRecordSync, writeIssueRecordSync } from '../pan-dir/record.js';
import { markRecordPipelineClosedOutSync } from '../pan-dir/records.js';
import { clearReviewStatus, getReviewStatusSync } from '../review-status.js';

describe('close-out terminal journal integration (PAN-2054)', () => {
  let projectRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    projectRoot = mkdtempSync(join(tmpdir(), 'close-out-terminal-'));
    mocks.project = { name: 'Overdeck', path: projectRoot };
    mocks.dbGet.mockReturnValue({
      issueId: 'PAN-2054',
      reviewStatus: 'passed',
      testStatus: 'passed',
      verificationStatus: 'running',
      mergeStatus: 'pending',
      readyForMerge: true,
      updatedAt: '2026-06-26T00:00:00.000Z',
    });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    mocks.project = undefined;
  });

  it('prevents stale active pipeline state from being re-derived after close-out', () => {
    writeIssueRecordSync(mocks.project!, 'PAN-2054', {
      issueId: 'PAN-2054',
      schemaVersion: 2,
      pipeline: {
        issueId: 'PAN-2054',
        reviewStatus: 'passed',
        testStatus: 'passed',
        verificationStatus: 'running',
        mergeStatus: 'pending',
        readyForMerge: true,
        updatedAt: '2026-06-26T00:00:00.000Z',
      },
      closeOut: {
        usage: { byStage: {}, totals: {} },
        merges: [],
        ranOn: 'test',
      },
    });

    markRecordPipelineClosedOutSync(mocks.project!, 'PAN-2054');
    clearReviewStatus('PAN-2054');

    expect(getReviewStatusSync('PAN-2054')).toBeNull();

    const record = readIssueRecordSync(mocks.project!, 'PAN-2054');
    expect(record?.pipeline.closedOut).toBe(true);
    expect(record?.pipeline.closedOutAt).toEqual(expect.any(String));
    expect(record?.pipeline.readyForMerge).toBe(false);
    expect(record?.pipeline.verificationStatus).toBeUndefined();
    expect(record?.pipeline.mergeStatus).toBe('merged');
    expect(mocks.dbDelete).toHaveBeenCalledWith('PAN-2054');
    expect(mocks.dbUpsert).not.toHaveBeenCalled();
  });
});
