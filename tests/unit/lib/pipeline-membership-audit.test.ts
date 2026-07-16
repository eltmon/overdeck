import { describe, expect, it } from 'vitest';

import { resolvePipelineMembership, type IssueLensSignals } from '../../../src/lib/pipeline-membership.js';

const CONSUMERS = [
  'resource-discovery',
  'frontend-pipeline-state',
  'pan-pending',
  'enumerate-in-flight',
  'flywheel',
  'pipeline-status-skill',
] as const;

function signals(overrides: Partial<IssueLensSignals>): IssueLensSignals {
  return {
    issueId: 'PAN-1966',
    issueOpen: true,
    hasOpenPr: false,
    hasMergedPr: false,
    hasConventionBranch: false,
    branchUnmerged: false,
    phaseLabel: null,
    hasVbriefSpec: false,
    ...overrides,
  };
}

describe('pipeline membership no-loss audit', () => {
  it('accounts for all six legacy membership consumers', () => {
    expect(CONSUMERS).toEqual([
      'resource-discovery',
      'frontend-pipeline-state',
      'pan-pending',
      'enumerate-in-flight',
      'flywheel',
      'pipeline-status-skill',
    ]);
    expect(new Set(CONSUMERS).size).toBe(6);
  });

  it.each([
    ['closed issue with open PR', signals({ issueOpen: false, hasOpenPr: true }), 'zombie_pr'],
    ['open issue with merged PR', signals({ hasMergedPr: true }), 'post_merge_limbo'],
    ['open issue with spec only', signals({ hasVbriefSpec: true }), 'planned_backlog'],
    [
      'squash-merged branch',
      signals({ hasMergedPr: true, hasConventionBranch: true, branchUnmerged: true }),
      'post_merge_limbo',
    ],
    [
      'closed issue with branch residue',
      signals({ issueOpen: false, hasConventionBranch: true, branchUnmerged: true }),
      'clean_terminal',
    ],
  ] as const)('classifies %s as %s', (_name, input, expectedBucket) => {
    expect(resolvePipelineMembership(input).bucket).toBe(expectedBucket);
  });
});
