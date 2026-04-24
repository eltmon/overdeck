import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Use vi.hoisted to avoid initialization order issues
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));
vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

// Mock getLinearApiKey to return null by default (no Linear)
vi.mock('../../../../src/lib/lifecycle/types.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/lifecycle/types.js')>();
  return {
    ...actual,
    getLinearApiKey: vi.fn().mockReturnValue(null),
  };
});

import { closeIssue } from '../../../../src/lib/lifecycle/close-issue.js';

describe('close-issue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GitHub issue close', () => {
    it('should close a GitHub issue via gh CLI', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const ctx = {
        issueId: 'PAN-100',
        projectPath: '/tmp/test',
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };

      const results = await closeIssue(ctx);
      const closeResult = results.find(r => r.step === 'close-issue:transition');
      expect(closeResult).toBeDefined();
      expect(closeResult!.success).toBe(true);
    });

    it('should close PR for GitHub issues', async () => {
      // First call: gh issue close, second: gh pr list, third: gh pr close, rest: labels
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // issue close
        .mockResolvedValueOnce({ stdout: '42', stderr: '' }) // pr list
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // pr close
        .mockResolvedValue({ stdout: '', stderr: '' }); // labels

      const ctx = {
        issueId: 'PAN-100',
        projectPath: '/tmp/test',
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };

      const results = await closeIssue(ctx);
      const prResult = results.find(r => r.step === 'close-issue:close-pr');
      expect(prResult).toBeDefined();
      expect(prResult!.success).toBe(true);
      expect(prResult!.details?.[0]).toContain('Closed PR #42');
    });

    it('should skip PR close when no open PR exists', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // issue close
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // pr list (empty)
        .mockResolvedValue({ stdout: '', stderr: '' }); // labels

      const ctx = {
        issueId: 'PAN-100',
        projectPath: '/tmp/test',
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };

      const results = await closeIssue(ctx);
      const prResult = results.find(r => r.step === 'close-issue:close-pr');
      expect(prResult).toBeDefined();
      expect(prResult!.skipped).toBe(true);
    });

    it('should not attempt PR close for non-GitHub issues', async () => {
      const ctx = {
        issueId: 'MIN-100',
        projectPath: '/tmp/test',
      };

      // Will fail to close (no tracker available), but should not attempt PR close
      const results = await closeIssue(ctx);
      const prResult = results.find(r => r.step === 'close-issue:close-pr');
      expect(prResult).toBeUndefined();
    });

    it('should apply labels on GitHub', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const ctx = {
        issueId: 'PAN-100',
        projectPath: '/tmp/test',
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };

      const results = await closeIssue(ctx, { applyLabel: true });
      const labelResult = results.find(r => r.step === 'close-issue:label');
      expect(labelResult).toBeDefined();
      expect(labelResult!.success).toBe(true);
    });

    it('should skip labels when applyLabel is false', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const ctx = {
        issueId: 'PAN-100',
        projectPath: '/tmp/test',
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };

      const results = await closeIssue(ctx, { applyLabel: false });
      const labelResult = results.find(r => r.step === 'close-issue:label');
      expect(labelResult).toBeUndefined();
    });
  });

  describe('labelOnly mode', () => {
    it('should skip issue transition when labelOnly is true', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const ctx = {
        issueId: 'PAN-100',
        projectPath: '/tmp/test',
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };

      const results = await closeIssue(ctx, { labelOnly: true });
      const closeResult = results.find(r => r.step === 'close-issue:transition');
      expect(closeResult).toBeUndefined();
    });
  });
});
