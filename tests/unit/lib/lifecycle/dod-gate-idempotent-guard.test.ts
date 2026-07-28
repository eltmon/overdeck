import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';
import type { PanIssuePipelineRecord } from '../../../../src/lib/pan-dir/record.js';

const mocks = vi.hoisted(() => ({
  resolveProjectForIssue: vi.fn(),
  getProjectConfigFromWorkspacePath: vi.fn(),
  readIssueRecord: vi.fn(),
  getReviewStatus: vi.fn(),
}));

vi.mock('../../../../src/lib/pan-dir/record.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/pan-dir/record.js')>();
  return {
    ...actual,
    resolveProjectForIssue: mocks.resolveProjectForIssue,
    getProjectConfigFromWorkspacePath: mocks.getProjectConfigFromWorkspacePath,
    readIssueRecord: mocks.readIssueRecord,
  };
});

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatus: mocks.getReviewStatus,
}));

import { readCompletedCloseOut } from '../../../../src/lib/lifecycle/dod-gate.js';

const issueId = 'PAN-3025';
const projectPath = '/tmp/test-project';

describe('readCompletedCloseOut idempotent guard (PAN-3025 WI-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectForIssue.mockReturnValue(null);
    mocks.getProjectConfigFromWorkspacePath.mockReturnValue({ name: 'test', path: projectPath });
  });

  it('ac1: pipeline.closedOut=true + no live row → returns closedOutAt (idempotent short-circuit)', async () => {
    // Record shows ceremony completed; live status absent → already done
    const record: PanIssuePipelineRecord = {
      issueId,
      schemaVersion: 2,
      pipeline: {
        closedOut: true,
        closedOutAt: '2026-07-28T08:00:00Z',
      } as any,
    } as any;
    mocks.readIssueRecord.mockResolvedValue(record);
    mocks.getReviewStatus.mockResolvedValue(null); // No live row

    const result = await readCompletedCloseOut(issueId, projectPath);

    expect(result).toBe('2026-07-28T08:00:00Z');
  });

  it('ac2: pipeline.closedOut=true + live row present → returns null (fall through to ceremony)', async () => {
    // Record shows closedOut=true but live row still exists → ceremony aborted mid-way, must complete it
    const record: PanIssuePipelineRecord = {
      issueId,
      schemaVersion: 2,
      pipeline: {
        closedOut: true,
        closedOutAt: '2026-07-28T08:00:00Z',
      } as any,
    } as any;
    mocks.readIssueRecord.mockResolvedValue(record);
    mocks.getReviewStatus.mockResolvedValue({
      reviewStatus: 'passed',
    } as ReviewStatus); // Live row exists

    const result = await readCompletedCloseOut(issueId, projectPath);

    expect(result).toBeNull(); // Fall through to gate
  });

  it('ac3: pipeline.closedOut=false → returns null (not completed yet)', async () => {
    // Record shows ceremony not started yet
    const record: PanIssuePipelineRecord = {
      issueId,
      schemaVersion: 2,
      pipeline: { closedOut: false } as any,
    } as any;
    mocks.readIssueRecord.mockResolvedValue(record);

    const result = await readCompletedCloseOut(issueId, projectPath);

    expect(result).toBeNull();
  });

  it('ac4: getReviewStatus read error → returns null (fail closed on uncertainty)', async () => {
    // Live status read fails; we cannot confirm absence → conservative: do not short-circuit
    const record: PanIssuePipelineRecord = {
      issueId,
      schemaVersion: 2,
      pipeline: { closedOut: true, closedOutAt: '2026-07-28T08:00:00Z' } as any,
    } as any;
    mocks.readIssueRecord.mockResolvedValue(record);
    mocks.getReviewStatus.mockRejectedValue(new Error('database read error'));

    const result = await readCompletedCloseOut(issueId, projectPath);

    expect(result).toBeNull(); // Fail closed
  });

  it('ac5: readIssueRecord error → returns null (fail closed on uncertainty)', async () => {
    // Record read fails; we cannot confirm closedOut status → conservative: do not short-circuit
    mocks.readIssueRecord.mockRejectedValue(new Error('file read error'));

    const result = await readCompletedCloseOut(issueId, projectPath);

    expect(result).toBeNull(); // Fail closed
  });
});
