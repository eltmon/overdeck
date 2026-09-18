import { describe, expect, it, vi } from 'vitest';

import {
  gatherMergeEligibility,
  isMergeEligible,
} from '../../../../src/lib/cloister/merge-eligibility.js';

describe('merge eligibility gathering', () => {
  it('does not gather project lenses when there are no candidates', async () => {
    const gather = vi.fn(async () => []);
    const memberships = await gatherMergeEligibility([], {
      resolveProject: vi.fn(),
      getProject: vi.fn(),
      gather,
    });

    expect(memberships.size).toBe(0);
    expect(gather).not.toHaveBeenCalled();
  });

  it('gathers once per represented project and only in-flight is merge-eligible', async () => {
    const gather = vi.fn(async () => [{
      issueId: 'PAN-1', issueOpen: true, hasOpenPr: true, hasMergedPr: false,
      hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false,
      phaseLabel: 'in-review', hasXbriefSpec: true, explicitlyReady: false,
      hasTerminalCloseOut: false,
    }]);
    const memberships = await gatherMergeEligibility(['PAN-1', 'PAN-2'], {
      resolveProject: vi.fn((issueId: string) => ({ projectKey: 'overdeck', projectName: 'Overdeck', projectPath: '/repo', linearTeam: issueId.split('-')[0] })),
      getProject: vi.fn(() => ({ name: 'Overdeck', path: '/repo', issue_prefix: 'PAN' })),
      gather,
    });

    expect(gather).toHaveBeenCalledOnce();
    expect(isMergeEligible(memberships.get('PAN-1')!)).toBe(true);
  });
});
