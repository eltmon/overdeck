import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Use hoisted to declare mockExecFile in the factory scope
const { mockExecFile } = vi.hoisted(() => {
  return {
    mockExecFile: vi.fn(),
  };
});

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

import { closeResidueConventionPrs } from '../../../../src/lib/lifecycle/residue.js';

describe('closeResidueConventionPrs', () => {
  beforeEach(() => {
    mockExecFile.mockClear();
  });

  afterEach(() => {
    // no fake timers needed — this helper has no retry/delay logic
  });

  it('returns stepSkipped when no open PRs/MRs found', async () => {
    // promisify expects callback as the last positional argument, after options
    // When there are no PRs to close, still record evidence of checking
    mockExecFile.mockImplementation((cmd: string, args: string[], opts: object, callback: Function) => {
      setImmediate(() => callback(null, { stdout: JSON.stringify([]) }));
    });

    const result = await closeResidueConventionPrs({
      issueId: 'PAN-123',
      projectPath: '/project',
      github: { repos: ['eltmon/overdeck'] },
    });

    expect(result.step).toBe('Close stale convention PRs/MRs');
    expect(result.success).toBe(true);
    // When all searches return empty, evidence list is populated with "No open..." messages
    // This means skipped=false (work was attempted, just found nothing)
    expect(result.skipped).toBe(false);
    expect(result.details).toBeDefined();
  });

  it('fails on any repository operation errors while preserving partial progress', async () => {
    let callCount = 0;
    mockExecFile.mockImplementation((cmd: string, args: string[], opts: object, callback: Function) => {
      setImmediate(() => {
        callCount++;
        if (callCount === 1) {
          // First call (GitHub PR list) returns one PR
          callback(null, { stdout: JSON.stringify([{ number: 123 }]) });
        } else if (callCount === 2) {
          // Second call (GitHub PR close for the found PR) fails
          callback(new Error('GitHub API rate limit exceeded'));
        } else {
          // Subsequent calls (retry on other head) succeed with empty list
          callback(null, { stdout: JSON.stringify([]) });
        }
      });
    });

    const result = await closeResidueConventionPrs({
      issueId: 'PAN-123',
      projectPath: '/project',
      github: { repos: ['eltmon/overdeck'] },
    });

    // Should fail due to the close error, but we still have evidence from finding the PR
    expect(result.success).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.error).toContain('GitHub API rate limit exceeded');
    expect(result.details).toBeDefined();
    // Details should contain partial progress (the list succeeded before close failed)
    expect(result.details?.some((d: string) => d.includes('Partial progress'))).toBe(true);
  });

  it('handles empty repository configuration as fully skipped', async () => {
    mockExecFile.mockImplementation((cmd: string, args: string[], opts: object, callback: Function) => {
      setImmediate(() => callback(null, { stdout: JSON.stringify([]) }));
    });

    const result = await closeResidueConventionPrs({
      issueId: 'PAN-123',
      projectPath: '/project',
      // No github or gitlab config — nothing to check
    });

    // When there are no configured repos, the step is skipped (no work attempted)
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.details).toBeDefined();
    expect(result.details?.[0]).toContain('No open convention PRs/MRs found');
  });
});
