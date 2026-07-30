import { describe, expect, it, vi } from 'vitest';

import { advanceMergeQueue, type MergeQueueAdvanceDeps } from '../merge-strike.js';
import type { ReviewStatus } from '../../../../../lib/review-status.js';

/**
 * PAN-3328: the merge queue must not be able to wedge behind an entry that
 * `triggerMerge()` would bounce before it claims the queue. These tests lock the
 * drain: unstartable heads are removed, the first startable entry is triggered,
 * and the walk always terminates.
 */

function reviewStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return { issueId: 'PAN-1', ...overrides } as ReviewStatus;
}

/** Build deps over an in-memory queue that behaves like dequeueMerge(). */
function harness(
  queue: string[],
  statuses: Record<string, ReviewStatus | null>,
): { deps: MergeQueueAdvanceDeps; queue: string[]; triggered: Array<[string, unknown]>; warnings: string[] } {
  const triggered: Array<[string, unknown]> = [];
  const warnings: string[] = [];
  const deps: MergeQueueAdvanceDeps = {
    dequeue: (_projectKey, completedIssueId) => {
      if (completedIssueId) {
        const index = queue.indexOf(completedIssueId);
        if (index >= 0) queue.splice(index, 1);
      }
      return queue[0] ?? null;
    },
    getReviewStatus: (issueId) => statuses[issueId] ?? null,
    getProjectPath: () => '/projects/overdeck',
    triggerMerge: async (issueId, request) => {
      triggered.push([issueId, request]);
      return { success: true };
    },
    log: () => {},
    warn: (message) => warnings.push(message),
  };
  return { deps, queue, triggered, warnings };
}

describe('advanceMergeQueue', () => {
  it('drops heads that triggerMerge would reject and starts the first startable entry', () => {
    const { deps, queue, triggered, warnings } = harness(
      ['PAN-100', 'PAN-200', 'PAN-300'],
      {
        // No review-status record at all — exactly the shape of the 12 rows that
        // wedged the real queue for 26 days.
        'PAN-100': null,
        'PAN-200': reviewStatus({ readyForMerge: true, mergeStatus: 'merged' }),
        'PAN-300': reviewStatus({ readyForMerge: true }),
      },
    );

    advanceMergeQueue(deps, 'pan');

    expect(triggered).toEqual([['PAN-300', undefined]]);
    expect(queue).toEqual(['PAN-300']);
    expect(warnings.join('\n')).toContain('Dropped PAN-100 from the pan merge queue');
    expect(warnings.join('\n')).toContain('Dropped PAN-200 from the pan merge queue');
  });

  it('removes the completed issue before choosing the next entry', () => {
    const { deps, queue, triggered } = harness(
      ['PAN-100', 'PAN-200'],
      { 'PAN-100': reviewStatus({ readyForMerge: true }), 'PAN-200': reviewStatus({ readyForMerge: true }) },
    );

    advanceMergeQueue(deps, 'pan', 'PAN-100');

    expect(queue).toEqual(['PAN-200']);
    expect(triggered).toEqual([['PAN-200', undefined]]);
  });

  it('empties a queue in which nothing can start, instead of stopping on the head', () => {
    const { deps, queue, triggered } = harness(
      ['PAN-100', 'PAN-200'],
      { 'PAN-100': null, 'PAN-200': null },
    );

    advanceMergeQueue(deps, 'pan');

    expect(queue).toEqual([]);
    expect(triggered).toEqual([]);
  });

  it('passes a strike request through without consulting normal merge eligibility', () => {
    const { deps, triggered } = harness(
      ['PAN-400'],
      {
        // A ready strike has readyForMerge=false — the strike path validates the
        // marker instead, so it must not be treated as an unstartable head.
        'PAN-400': reviewStatus({ readyForMerge: false, strikeLandingState: 'ready', strikeReadyHead: 'abc123' }),
      },
    );

    advanceMergeQueue(deps, 'pan');

    expect(triggered).toEqual([[
      'PAN-400',
      {
        kind: 'strike',
        markerHead: 'abc123',
        workspacePath: '/projects/overdeck/workspaces/feature-pan-400-strike',
        branchName: 'strike/pan-400',
        recoveryTarget: 'strike-pan-400',
      },
    ]]);
  });

  it('terminates when the queue keeps handing back the same unstartable entry', () => {
    const dequeue = vi.fn(() => 'PAN-100');
    advanceMergeQueue(
      {
        dequeue,
        getReviewStatus: () => null,
        getProjectPath: () => '/projects/overdeck',
        triggerMerge: async () => ({}),
        log: () => {},
        warn: () => {},
      },
      'pan',
    );

    expect(dequeue).toHaveBeenCalledTimes(2);
  });
});
