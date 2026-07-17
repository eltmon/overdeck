import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VBriefDocument } from '../../../../src/lib/xbrief/types.js';
import {
  finalizeSwarmIssueIfComplete,
  type RequestIssueReviewResult,
} from '../../../../src/lib/cloister/deacon-swarm-finalization.js';

const mocks = vi.hoisted(() => ({
  getReviewStatusSync: vi.fn(),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
}));

type FinalizationDeps = Parameters<typeof finalizeSwarmIssueIfComplete>[3];

beforeEach(() => {
  mocks.getReviewStatusSync.mockReset();
  mocks.getReviewStatusSync.mockReturnValue(null);
});

function makeCompletedDoc(issueId: string): VBriefDocument {
  const now = '2026-07-04T00:00:00.000Z';
  return {
    vBRIEFInfo: {
      version: '0.6',
      created: now,
      author: 'test',
      description: `Plan for ${issueId}`,
    },
    plan: {
      id: issueId.toLowerCase(),
      title: `Plan for ${issueId}`,
      status: 'running',
      created: now,
      updated: now,
      items: [
        {
          id: 'wi-1',
          title: 'Work item 1',
          status: 'completed',
          metadata: {
            readiness: 'ready',
            files_scope: ['src/example-1.ts'],
            files_scope_confidence: 'high',
            verify_commands: ['npm run typecheck'],
            expected_outputs: ['typecheck completes without errors'],
          },
        },
        {
          id: 'wi-2',
          title: 'Work item 2',
          status: 'completed',
          metadata: {
            readiness: 'ready',
            files_scope: ['src/example-2.ts'],
            files_scope_confidence: 'high',
            verify_commands: ['npm run typecheck'],
            expected_outputs: ['typecheck completes without errors'],
          },
        },
      ],
      edges: [],
    },
  };
}

function makeDeps(overrides: Partial<FinalizationDeps> = {}): FinalizationDeps {
  return {
    requestIssueReview: vi.fn(async (): Promise<RequestIssueReviewResult> => ({
      success: true,
      message: 'dispatched',
    })),
    ...overrides,
  };
}

describe('finalizeSwarmIssueIfComplete durable finalization guard', () => {
  it('persists one finalization across repeated review-status clears', async () => {
    const issueId = 'PAN-940';
    const workspacePath = '/tmp/feature-pan-940';
    const doc = makeCompletedDoc(issueId);
    let finalizedAt: string | undefined;
    const requestIssueReview = vi.fn(async (): Promise<RequestIssueReviewResult> => ({
      success: true,
      message: 'dispatched',
    }));
    const deps = makeDeps({
      getFinalizedAt: vi.fn(() => finalizedAt),
      setFinalizedAt: vi.fn((_issueId, _workspacePath, value) => {
        finalizedAt = value;
      }),
      requestIssueReview,
    });

    const first = await finalizeSwarmIssueIfComplete(issueId, workspacePath, doc, deps);
    mocks.getReviewStatusSync.mockReturnValue(null);
    const second = await finalizeSwarmIssueIfComplete(issueId, workspacePath, doc, deps);
    mocks.getReviewStatusSync.mockReturnValue(null);
    const third = await finalizeSwarmIssueIfComplete(issueId, workspacePath, doc, deps);

    expect(first).toEqual(['[swarm] finalized PAN-940: issue-level review requested']);
    expect(second).toEqual([]);
    expect(third).toEqual([]);
    expect(requestIssueReview).toHaveBeenCalledTimes(1);
    expect(deps.setFinalizedAt).toHaveBeenCalledTimes(1);
  });

  it('skips when a durable finalizedAt tombstone already exists', async () => {
    const requestIssueReview = vi.fn(async (): Promise<RequestIssueReviewResult> => ({
      success: true,
      message: 'dispatched',
    }));
    const deps = makeDeps({
      getFinalizedAt: vi.fn(() => '2026-07-04T01:00:00.000Z'),
      requestIssueReview,
    });

    const actions = await finalizeSwarmIssueIfComplete('PAN-941', '/tmp/feature-pan-941', makeCompletedDoc('PAN-941'), deps);

    expect(actions).toEqual([]);
    expect(requestIssueReview).not.toHaveBeenCalled();
  });

  it('skips when review status is already merged', async () => {
    mocks.getReviewStatusSync.mockReturnValue({ mergeStatus: 'merged' });
    const requestIssueReview = vi.fn(async (): Promise<RequestIssueReviewResult> => ({
      success: true,
      message: 'dispatched',
    }));
    const deps = makeDeps({
      getFinalizedAt: vi.fn(() => undefined),
      requestIssueReview,
    });

    const actions = await finalizeSwarmIssueIfComplete('PAN-942', '/tmp/feature-pan-942', makeCompletedDoc('PAN-942'), deps);

    expect(actions).toEqual([]);
    expect(requestIssueReview).not.toHaveBeenCalled();
  });

  it('writes finalizedAt after a successful issue review request', async () => {
    const requestIssueReview = vi.fn(async (): Promise<RequestIssueReviewResult> => ({
      success: true,
      message: 'dispatched',
    }));
    const setFinalizedAt = vi.fn();
    const deps = makeDeps({
      getFinalizedAt: vi.fn(() => undefined),
      setFinalizedAt,
      requestIssueReview,
    });

    const actions = await finalizeSwarmIssueIfComplete('PAN-943', '/tmp/feature-pan-943', makeCompletedDoc('PAN-943'), deps);

    expect(actions).toEqual(['[swarm] finalized PAN-943: issue-level review requested']);
    expect(requestIssueReview).toHaveBeenCalledTimes(1);
    expect(setFinalizedAt).toHaveBeenCalledTimes(1);
    expect(setFinalizedAt).toHaveBeenCalledWith('PAN-943', '/tmp/feature-pan-943', expect.any(String));
  });

  it('does not write finalizedAt when review dispatch is deferred and retries later', async () => {
    const requestIssueReview = vi.fn(async (): Promise<RequestIssueReviewResult> => ({
      success: false,
      message: 'not ready',
      error: 'review gate closed',
    }));
    const setFinalizedAt = vi.fn();
    const deps = makeDeps({
      getFinalizedAt: vi.fn(() => undefined),
      setFinalizedAt,
      requestIssueReview,
    });
    const doc = makeCompletedDoc('PAN-944');

    const first = await finalizeSwarmIssueIfComplete('PAN-944', '/tmp/feature-pan-944', doc, deps);
    const second = await finalizeSwarmIssueIfComplete('PAN-944', '/tmp/feature-pan-944', doc, deps);

    expect(first).toEqual(['[swarm] finalization deferred PAN-944: review gate closed']);
    expect(second).toEqual(['[swarm] finalization deferred PAN-944: review gate closed']);
    expect(requestIssueReview).toHaveBeenCalledTimes(2);
    expect(setFinalizedAt).not.toHaveBeenCalled();
  });
});
