import { describe, expect, it, vi } from 'vitest';
import { closeResidueConventionPrs } from '../../../../src/lib/lifecycle/residue.js';

describe('closeResidueConventionPrs', () => {
  it('returns stepSkipped when no open PRs/MRs found', async () => {
    const result = await closeResidueConventionPrs({
      issueId: 'PAN-123',
      projectPath: '/project',
      github: { owner: 'eltmon', repo: 'overdeck' },
    });

    expect(result.step).toBe('Close stale convention PRs/MRs');
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.details).toContain('No open convention PRs/MRs found');
  });
});
