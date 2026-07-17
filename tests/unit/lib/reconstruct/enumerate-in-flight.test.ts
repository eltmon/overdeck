import { describe, expect, it, vi } from 'vitest';

import { enumerateInFlightIssuesFromSources } from '../../../../src/lib/reconstruct/enumerate-in-flight.js';
import type { IssueLensSignals } from '../../../../src/lib/pipeline-membership.js';
import type { ProjectConfig } from '../../../../src/lib/projects.js';

const project: ProjectConfig = { name: 'overdeck', path: '/projects/overdeck' };
const signal = (over: Partial<IssueLensSignals>): IssueLensSignals => ({
  issueId: 'PAN-1', issueOpen: true, hasOpenPr: false, hasMergedPr: false,
  hasConventionBranch: false, branchUnmerged: false, phaseLabel: null, hasVbriefSpec: false, explicitlyReady: false,
  ...over,
});

describe('enumerateInFlightIssuesFromSources', () => {
  it('uses authoritative membership and includes post-merge limbo without a workspace', async () => {
    const gather = vi.fn().mockResolvedValue([
      signal({ issueId: 'PAN-1', hasOpenPr: true }),
      signal({ issueId: 'PAN-2', hasMergedPr: true }),
      signal({ issueId: 'PAN-3' }),
    ]);

    const result = await enumerateInFlightIssuesFromSources([project], gather);

    expect([...result].sort()).toEqual(['PAN-1', 'PAN-2']);
    expect(gather).toHaveBeenCalledWith(project);
  });

  it('degrades per project on gather failure instead of throwing (PAN-2820 boot safety)', async () => {
    const broken: ProjectConfig = { name: 'lexerra', path: '/projects/lexerra' };
    const gather = vi.fn(async (p: ProjectConfig) => {
      if (p.name === 'lexerra') throw new Error('GitHub API GET /repos/eltmon/lexerra/issues failed: 404');
      return [signal({ issueId: 'PAN-1', hasOpenPr: true })];
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await enumerateInFlightIssuesFromSources([project, broken], gather);

    expect([...result]).toEqual(['PAN-1']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping project lexerra'));
    errorSpy.mockRestore();
  });
});
