/**
 * PAN-4753 D4: the schedule door's forge-free policy applies the merge route
 * rule. Train off never refuses; train on refuses only normal priority.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../issue-service-singleton.js', () => ({ getSharedIssueService: () => ({ getTrackerIssue: () => null }) }));

const { autoMergePolicyRefusal } = await import('../auto-merge-door-policy.js');

function refusal(opts: { labels?: string[]; trainOn: boolean; dropped?: boolean; projectDefault?: 'auto' | 'hold'; requireUat?: boolean }) {
  return autoMergePolicyRefusal('PAN-9', {
    getIssueLabels: () => opts.labels ?? [],
    getProjectAutoMergeDefault: () => opts.projectDefault,
    isRequireUatBeforeMerge: () => opts.requireUat ?? false,
    isIssueClosed: () => false,
    isTrainOn: () => opts.trainOn,
    droppedFromBatch: () => opts.dropped ?? false,
  });
}

const BATCH = { status: 412, body: { error: 'the merge train batches this PR; it merges with the next batch' } };

describe('autoMergePolicyRefusal (PAN-4753 D4)', () => {
  it('never refuses a normal PR because the train is off: off means per-PR merges', () => {
    expect(refusal({ trainOn: false })).toBeNull();
  });

  it('refuses a normal-priority PR while the train is on: it waits for the batch', () => {
    expect(refusal({ trainOn: true })).toEqual(BATCH);
    expect(refusal({ trainOn: true, labels: ['substrate-improvement'] })).toEqual(BATCH);
  });

  it.each([
    [['critical']],
    [['blocks-main']],
    [['substrate-improvement', 'bug']],
  ])('lets high priority %j through while the train is on', (labels) => {
    expect(refusal({ trainOn: true, labels })).toBeNull();
  });

  it('lets a member dropped from a batch through while the train is on', () => {
    expect(refusal({ trainOn: true, dropped: true })).toBeNull();
  });

  it('keeps the UAT hold above priority', () => {
    expect(refusal({ trainOn: true, labels: ['critical', 'hold-for-uat'] }))
      .toEqual({ status: 412, body: { error: 'UAT is still required before merge' } });
    expect(refusal({ trainOn: false, labels: ['critical'], projectDefault: 'hold' }))
      .toEqual({ status: 412, body: { error: 'UAT is still required before merge' } });
  });
});
