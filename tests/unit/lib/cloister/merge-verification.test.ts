import { describe, expect, it } from 'vitest';
import { shouldSkipDispatchAsMerged } from '../../../../src/lib/cloister/merge-verification.js';

describe('shouldSkipDispatchAsMerged', () => {
  it('returns skip:true with the merge reason when the PR is merged', async () => {
    const result = await shouldSkipDispatchAsMerged('PAN-2420', {
      resolveProject: () => ({ projectPath: '/tmp/project' }),
      verifyMerged: async () => ({ merged: true, reason: 'GitHub PR #2420 is merged' }),
    });

    expect(result.skip).toBe(true);
    expect(result.reason).toContain('GitHub PR #2420 is merged');
  });

  it('returns skip:false when the PR is open', async () => {
    const result = await shouldSkipDispatchAsMerged('PAN-2420', {
      resolveProject: () => ({ projectPath: '/tmp/project' }),
      verifyMerged: async () => ({ merged: false, reason: 'GitHub PR for feature/pan-2420 is open and not merged' }),
    });

    expect(result.skip).toBe(false);
    expect(result.reason).toContain('open and not merged');
  });

  it('returns skip:false when the project is unresolved', async () => {
    const result = await shouldSkipDispatchAsMerged('PAN-2420', {
      resolveProject: () => null,
    });

    expect(result.skip).toBe(false);
    expect(result.reason).toContain('Project unresolved');
  });

  it('fails open when the GitHub read throws', async () => {
    const result = await shouldSkipDispatchAsMerged('PAN-2420', {
      resolveProject: () => ({ projectPath: '/tmp/project' }),
      verifyMerged: async () => { throw new Error('GitHub API rate limited'); },
    });

    expect(result.skip).toBe(false);
    expect(result.reason).toContain('rate limited');
  });

  it('uses the default branch naming convention', async () => {
    let capturedBranch: string | undefined;
    await shouldSkipDispatchAsMerged('MIN-123', {
      resolveProject: () => ({ projectPath: '/tmp/project' }),
      verifyMerged: async (_issueId, _projectPath, branch) => {
        capturedBranch = branch;
        return { merged: false, reason: 'open' };
      },
    });

    expect(capturedBranch).toBe('feature/min-123');
  });
});
