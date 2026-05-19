import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let mockExecAsync: ReturnType<typeof vi.fn>;

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));
vi.mock('util', () => ({
  promisify: () => (...args: any[]) => mockExecAsync(...args),
}));
vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentStateAsync: vi.fn().mockResolvedValue(null),
  markAgentStoppedState: vi.fn((state: unknown) => state),
  saveAgentStateAsync: vi.fn().mockResolvedValue(undefined),
}));

// Mock lifecycle helpers used by close-issue
vi.mock('../../../../src/lib/lifecycle/types.js', () => ({
  stepOk: (step: string, details?: string[]) => ({ step, success: true, skipped: false, details }),
  stepSkipped: (step: string, details?: string[]) => ({ step, success: true, skipped: true, details }),
  stepFailed: (step: string, error: string) => ({ step, success: false, skipped: false, error }),
  getLinearApiKey: vi.fn().mockReturnValue(null),
}));

import { Effect } from 'effect';
import { closeIssue as closeIssueEffect } from '../../../../src/lib/lifecycle/close-issue.js';

const closeIssue = (...args: Parameters<typeof closeIssueEffect>) =>
  Effect.runPromise(closeIssueEffect(...args));

describe('close-issue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync = vi.fn().mockImplementation(async (...args: any[]) => {
      const command = String(args[0] ?? '');
      if (command.includes('gh pr list')) return { stdout: '', stderr: '' };
      return { stdout: '', stderr: '' };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
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

    it('should include the PR-close step for GitHub issues', async () => {
      const ctx = {
        issueId: 'PAN-100',
        projectPath: '/tmp/test',
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };

      const results = await closeIssue(ctx);
      const prResult = results.find(r => r.step === 'close-issue:close-pr');
      expect(prResult).toBeDefined();
      expect(prResult!.success).toBe(true);
    });

    it('should skip PR close when no open PR exists', async () => {
      mockExecAsync.mockImplementation(async (...args: any[]) => {
        const command = String(args[0] ?? '');
        if (command.includes('gh pr list')) return { stdout: '', stderr: '' };
        return { stdout: '', stderr: '' };
      });

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

    it('adds closed-out and removes workflow labels in one GitHub edit', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const ctx = {
        issueId: 'PAN-100',
        projectPath: '/tmp/test',
        github: { owner: 'eltmon', repo: 'panopticon-cli', number: 100 },
      };

      await closeIssue(ctx, { applyLabel: true });

      const editCalls = mockExecAsync.mock.calls
        .map((call: any[]) => String(call[0]))
        .filter(command => command.includes('gh issue edit 100') && command.includes('--add-label "closed-out"'));
      expect(editCalls).toHaveLength(1);
      expect(editCalls[0]).toContain('--remove-label "verifying-on-main"');
      expect(editCalls[0]).toContain('--remove-label "needs-close-out"');
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
