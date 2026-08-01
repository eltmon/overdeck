import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { closeResidueConventionPrs } from '../../../../src/lib/lifecycle/residue.js';

describe('closeResidueConventionPrs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns stepSkipped when no open PRs/MRs found', async () => {
    vi.mocked(vi.hoisted(() => require('child_process')).execFile, true);

    const result = await closeResidueConventionPrs({
      issueId: 'PAN-123',
      projectPath: '/project',
      github: 'eltmon/overdeck',
    });

    expect(result.step).toBe('Close stale convention PRs/MRs');
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.details).toContain('No open convention PRs/MRs found');
  });

  it('fails on any repository operation errors while preserving partial progress', async () => {
    // Mock execFile to succeed on first call, fail on second
    let callCount = 0;
    const mockExecFile = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call (GitHub PR list) succeeds
        return { stdout: JSON.stringify([{ number: 123 }]) };
      }
      // Second call (GitHub PR close) fails
      throw new Error('GitHub API rate limit exceeded');
    });

    vi.doMock('child_process', () => ({
      execFile: mockExecFile,
    }));

    const result = await closeResidueConventionPrs({
      issueId: 'PAN-123',
      projectPath: '/project',
      github: 'eltmon/overdeck',
    });

    // Should fail due to the close error, even though the list succeeded
    expect(result.success).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.error).toContain('GitHub API rate limit exceeded');
    expect(result.details).toBeDefined();
    expect(result.details?.[0]).toContain('Partial progress');
  });
});
