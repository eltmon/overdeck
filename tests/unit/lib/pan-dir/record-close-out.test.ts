import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  getProjectConfigFromWorkspacePath,
  readIssueRecordSync,
  writeIssueRecordSync,
  markRecordPipelineClosedOutSync,
  type PanIssueRecord,
} from '../../../../src/lib/pan-dir/record.js';

const mockQueueAutoCommit = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/pan-dir/auto-commit.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/pan-dir/auto-commit.js')>(
    '../../../../src/lib/pan-dir/auto-commit.js',
  );
  return {
    ...actual,
    // Stub the queue so no real background git work is scheduled in tests.
    queueAutoCommit: mockQueueAutoCommit,
  };
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.resetAllMocks();
});

function baseRecord(issueId: string): PanIssueRecord {
  const now = new Date().toISOString();
  return {
    issueId,
    schemaVersion: 2,
    created: now,
    updated: now,
    pipeline: {
      issueId,
      reviewStatus: 'passed',
      testStatus: 'passed',
      verificationStatus: 'passed',
      lastVerifiedCommit: 'abc1234567890',
      readyForMerge: false,
      updatedAt: now,
    },
    closeOut: {
      usage: { byStage: {}, totals: {} },
      merges: [],
      ranOn: 'test-host',
    },
  } as PanIssueRecord;
}

describe('markRecordPipelineClosedOutSync preserves verificationStatus (PAN-3025)', () => {
  it('ac1: preserves verificationStatus and lastVerifiedCommit after close-out', () => {
    const ws = mkdtempSync(join(tmpdir(), 'pan-record-close-out-'));
    dirs.push(ws);
    const project = getProjectConfigFromWorkspacePath(ws);
    const record = baseRecord('PAN-3025');

    // Seed with verificationStatus and lastVerifiedCommit
    writeIssueRecordSync(project, 'PAN-3025', record);

    // Run close-out
    markRecordPipelineClosedOutSync(project, 'PAN-3025');

    // Verify the verdict was preserved
    const after = readIssueRecordSync(project, 'PAN-3025');
    expect(after?.pipeline.verificationStatus).toBe('passed');
    expect(after?.pipeline.lastVerifiedCommit).toBe('abc1234567890');
    expect(after?.pipeline.closedOut).toBe(true);
    expect(after?.pipeline.closedOutAt).toBeDefined();
  });

  it('ac2: preserves lastVerifiedCommit and sets mergeStatus', () => {
    const ws = mkdtempSync(join(tmpdir(), 'pan-record-close-out-'));
    dirs.push(ws);
    const project = getProjectConfigFromWorkspacePath(ws);
    const record = baseRecord('PAN-3025');

    writeIssueRecordSync(project, 'PAN-3025', record);
    markRecordPipelineClosedOutSync(project, 'PAN-3025');

    const after = readIssueRecordSync(project, 'PAN-3025');
    expect(after?.pipeline.lastVerifiedCommit).toBe('abc1234567890');
    expect(after?.pipeline.mergeStatus).toBe('merged');
  });

  it('ac3: queueAutoCommit is called via queueIssueRecordCommit', () => {
    const ws = mkdtempSync(join(tmpdir(), 'pan-record-close-out-'));
    dirs.push(ws);
    const project = getProjectConfigFromWorkspacePath(ws);
    const record = baseRecord('PAN-3025');

    writeIssueRecordSync(project, 'PAN-3025', record);
    mockQueueAutoCommit.mockClear();
    markRecordPipelineClosedOutSync(project, 'PAN-3025');

    expect(mockQueueAutoCommit).toHaveBeenCalled();
  });
});
