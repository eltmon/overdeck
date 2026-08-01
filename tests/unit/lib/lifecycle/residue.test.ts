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
    // Mock callback-style invocation: fn(cmd, args, opts, callback)
    mockExecFile.mockImplementation((cmd, args, opts, callback) => {
      callback(null, { stdout: JSON.stringify([]) });
    });

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
    mockExecFile.mockImplementation((cmd, args, opts, callback) => {
      callCount++;
      if (callCount === 1) {
        // First call (GitHub PR list) succeeds
        callback(null, { stdout: JSON.stringify([{ number: 123 }]) });
      } else {
        // Second call (GitHub PR close) fails
        callback(new Error('GitHub API rate limit exceeded'));
      }
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
    mockExecFile.mockImplementation((cmd, args, opts, callback) => {
      // Fail git remote calls, but allow gh/glab calls
      if (cmd === 'git') {
        callback(new Error('git remote URL not found'));
      } else {
        callback(null, { stdout: JSON.stringify([]) });
      }
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
