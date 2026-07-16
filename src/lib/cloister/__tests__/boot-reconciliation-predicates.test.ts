import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../review-status.js';

const mocks = vi.hoisted(() => ({
  reviewStatuses: new Map<string, Partial<ReviewStatus>>(),
}));

vi.mock('../../review-status.js', () => ({
  getReviewStatusSync: vi.fn((issueId: string) => mocks.reviewStatuses.get(issueId) ?? null),
}));

import { bootReconciliationSkipReason } from '../boot-reconciliation-predicates.js';

function reviewStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: overrides.issueId ?? 'PAN-2284',
    reviewStatus: overrides.reviewStatus ?? 'pending',
    testStatus: overrides.testStatus ?? 'pending',
    updatedAt: overrides.updatedAt ?? '2026-07-03T12:00:00.000Z',
    readyForMerge: overrides.readyForMerge ?? false,
    ...overrides,
  };
}

describe('bootReconciliationSkipReason', () => {
  let testHome: string;
  let workspace: string;

  beforeEach(() => {
    testHome = join(tmpdir(), `pan-2284-boot-predicates-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    workspace = join(testHome, 'workspace');
    mkdirSync(workspace, { recursive: true });
    process.env.OVERDECK_HOME = testHome;
    mocks.reviewStatuses.clear();
  });

  afterEach(() => {
    delete process.env.OVERDECK_HOME;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('returns workspace_missing when workspace is null or missing, and null when the workspace exists', () => {
    expect(bootReconciliationSkipReason({
      id: 'agent-pan-2284',
      issueId: 'PAN-2284',
      workspace: null,
    })).toBe('workspace_missing');

    expect(bootReconciliationSkipReason({
      id: 'agent-pan-2284',
      issueId: 'PAN-2284',
      workspace: join(testHome, 'missing-workspace'),
    })).toBe('workspace_missing');

    expect(bootReconciliationSkipReason({
      id: 'agent-pan-2284',
      issueId: 'PAN-2284',
      workspace,
    })).toBeNull();
  });

  it('returns merged when review mergeStatus is merged', () => {
    mocks.reviewStatuses.set('PAN-2284', reviewStatus({ mergeStatus: 'merged' }));

    expect(bootReconciliationSkipReason({
      id: 'agent-pan-2284',
      issueId: 'PAN-2284',
      workspace,
    })).toBe('merged');
  });

  it('returns merged when the agent state carries merged=true', () => {
    expect(bootReconciliationSkipReason({
      id: 'agent-pan-2284',
      issueId: 'PAN-2284',
      workspace,
      merged: true,
    })).toBe('merged');
  });

  it('returns merged when review is readyForMerge with review and test passed', () => {
    mocks.reviewStatuses.set('PAN-2284', reviewStatus({
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
    }));

    expect(bootReconciliationSkipReason({
      id: 'agent-pan-2284',
      issueId: 'PAN-2284',
      workspace,
    })).toBe('merged');
  });

  it('returns completed when a completion marker exists and review and test both passed', () => {
    const agentDir = join(testHome, 'agents', 'agent-pan-2284');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'completed'), '');
    mocks.reviewStatuses.set('PAN-2284', reviewStatus({
      reviewStatus: 'passed',
      testStatus: 'passed',
    }));

    expect(bootReconciliationSkipReason({
      id: 'agent-pan-2284',
      issueId: 'PAN-2284',
      workspace,
    })).toBe('completed');
  });

  it('treats completed.processed as a completion marker', () => {
    const agentDir = join(testHome, 'agents', 'agent-pan-2284');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'completed.processed'), '');
    mocks.reviewStatuses.set('PAN-2284', reviewStatus({
      reviewStatus: 'passed',
      testStatus: 'passed',
    }));

    expect(bootReconciliationSkipReason({
      id: 'agent-pan-2284',
      issueId: 'PAN-2284',
      workspace,
    })).toBe('completed');
  });

  it('returns null when a completion marker exists but review is blocked', () => {
    const agentDir = join(testHome, 'agents', 'agent-pan-2284');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'completed'), '');
    mocks.reviewStatuses.set('PAN-2284', reviewStatus({
      reviewStatus: 'blocked',
      testStatus: 'passed',
    }));

    expect(bootReconciliationSkipReason({
      id: 'agent-pan-2284',
      issueId: 'PAN-2284',
      workspace,
    })).toBeNull();
  });

  // The boot dialog's candidate list must agree with the resume executor
  // (handleAgentStoppedEvent). It previously skipped only on passed/passed, so a
  // handed-off agent awaiting review offered itself as a candidate and was then
  // refused as "pipeline mid-flight" — the dialog asked a settled question.
  it.each([
    ['pending', 'pending'],
    ['passed', 'pending'],
    ['pending', 'passed'],
  ] as const)(
    'returns completed for a handed-off agent mid-flight in the pipeline (review=%s, test=%s)',
    (reviewStatusValue, testStatusValue) => {
      const agentDir = join(testHome, 'agents', 'agent-pan-2284');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, 'completed'), '');
      mocks.reviewStatuses.set('PAN-2284', reviewStatus({
        reviewStatus: reviewStatusValue,
        testStatus: testStatusValue,
      }));

      expect(bootReconciliationSkipReason({
        id: 'agent-pan-2284',
        issueId: 'PAN-2284',
        workspace,
      })).toBe('completed');
    },
  );

  it('returns null when a completion marker exists but test failed', () => {
    const agentDir = join(testHome, 'agents', 'agent-pan-2284');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'completed'), '');
    mocks.reviewStatuses.set('PAN-2284', reviewStatus({
      reviewStatus: 'passed',
      testStatus: 'failed',
    }));

    expect(bootReconciliationSkipReason({
      id: 'agent-pan-2284',
      issueId: 'PAN-2284',
      workspace,
    })).toBeNull();
  });

  it('returns null when no completion marker exists, so a crashed mid-work agent stays resumable', () => {
    mocks.reviewStatuses.set('PAN-2284', reviewStatus({
      reviewStatus: 'pending',
      testStatus: 'pending',
    }));

    expect(bootReconciliationSkipReason({
      id: 'agent-pan-2284',
      issueId: 'PAN-2284',
      workspace,
    })).toBeNull();
  });
});
