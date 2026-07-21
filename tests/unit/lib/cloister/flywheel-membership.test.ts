import { describe, expect, it } from 'vitest';

import { isIssueInResolvedPipeline } from '../../../../src/lib/cloister/flywheel.js';
import type { PipelineMembership } from '../../../../src/lib/pipeline-membership.js';

function membership(issueId: string, bucket: PipelineMembership['bucket']): PipelineMembership {
  return {
    issueId,
    inPipeline: bucket !== 'clean_terminal',
    bucket,
    reasons: [bucket],
    labelDrift: null,
    lenses: { L1_openPr: false, L2_unmergedBranch: false, L3_issueOpen: true, L4_phaseLabel: null },
  };
}

describe('flywheel pipeline membership', () => {
  it('uses resolver verdicts instead of workspace presence', () => {
    const memberships = [
      membership('PAN-1', 'clean_terminal'),
      membership('PAN-2', 'post_merge_limbo'),
    ];

    expect(isIssueInResolvedPipeline('PAN-1', memberships)).toBe(false);
    expect(isIssueInResolvedPipeline('PAN-2', memberships)).toBe(true);
  });
});
