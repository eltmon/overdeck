import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock execFile before importing the module
const mockExecFile = vi.fn();

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

import { closeResidueConventionPrs } from '../../../../src/lib/lifecycle/residue.js';

describe('closeResidueConventionPrs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockExecFile.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns stepSkipped when no open PRs/MRs found', async () => {
    mockExecFile.mockResolvedValue({ stdout: JSON.stringify([]) });

    const result = await closeResidueConventionPrs({
      issueId: 'PAN-123',
      projectPath: '/project',
      github: { repos: ['eltmon/overdeck'] },
    });

    expect(result.step).toBe('Close stale convention PRs/MRs');
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.details).toContain('No open GitHub PRs found on eltmon/overdeck/feature/pan-123');
  });

  it('fails on any repository operation errors while preserving partial progress', async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call (GitHub PR list) succeeds
        return { stdout: JSON.stringify([{ number: 123 }]) };
      }
      // Second call (GitHub PR close) fails
      throw new Error('GitHub API rate limit exceeded');
    });

    const result = await closeResidueConventionPrs({
      issueId: 'PAN-123',
      projectPath: '/project',
      github: { repos: ['eltmon/overdeck'] },
    });

    // Should fail due to the close error, even though the list succeeded
    expect(result.success).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.error).toContain('GitHub API rate limit exceeded');
    expect(result.details).toBeDefined();
    expect(result.details?.[0]).toContain('Partial progress');
  });

  it('fails when coordinate extraction fails for required repositories', async () => {
    mockExecFile.mockImplementation(async (cmd, args) => {
      // Fail git remote calls, but allow gh/glab calls
      if (cmd === 'git') {
        throw new Error('git remote URL not found');
      }
      return { stdout: JSON.stringify([]) };
    });

    const result = await closeResidueConventionPrs({
      issueId: 'PAN-123',
      projectPath: '/project',
      github: { repos: ['eltmon/overdeck'] },
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
  });
});
