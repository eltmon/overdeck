import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use vi.hoisted to avoid initialization order issues
const { mockExecAsync, mockGetLinearApiKey } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  mockGetLinearApiKey: vi.fn().mockReturnValue(null),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));
vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

vi.mock('../../../../src/lib/lifecycle/types.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/lifecycle/types.js')>();
  return {
    ...actual,
    getLinearApiKey: mockGetLinearApiKey,
  };
});

// Linear SDK mock — controls what the SDK returns per-test
const mockIssueUpdate = vi.fn().mockResolvedValue({});
const mockIssueLabels = vi.fn().mockResolvedValue({ nodes: [] });
const mockClientIssues = vi.fn();
const mockClientIssueLabels = vi.fn();
const mockClientCreateIssueLabel = vi.fn();

vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn().mockImplementation(function () { return {
    issues: mockClientIssues,
    issueLabels: mockClientIssueLabels,
    createIssueLabel: mockClientCreateIssueLabel,
  }; }),
}));

import { Effect } from 'effect';
import { cleanupMergedLabels as cleanupMergedLabelsProgram } from '../../../../src/lib/lifecycle/label-cleanup.js';

const cleanupMergedLabels = (...args: Parameters<typeof cleanupMergedLabelsProgram>) =>
  Effect.runPromise(cleanupMergedLabelsProgram(...args));

describe('cleanupMergedLabels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLinearApiKey.mockReturnValue(null); // Default: no Linear
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  describe('GitHub', () => {
    const ctx = {
      issueId: 'PAN-338',
      projectPath: '/tmp/test',
      github: { owner: 'eltmon', repo: 'panopticon-cli', number: 338 },
    };

    it('returns ok with merged label applied', async () => {
      const result = await cleanupMergedLabels(ctx);

      expect(result.step).toBe('label-cleanup:merged');
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.details?.some(d => d.includes('merged'))).toBe(true);
    });

    it('calls gh label create to ensure merged label exists', async () => {
      await cleanupMergedLabels(ctx);

      const calls = mockExecAsync.mock.calls.map((c: any[]) => c[0] as string);
      expect(calls.some(c => c.includes('gh label create') && c.includes('"merged"'))).toBe(true);
    });

    it('calls gh issue edit to add merged label', async () => {
      await cleanupMergedLabels(ctx);

      const calls = mockExecAsync.mock.calls.map((c: any[]) => c[0] as string);
      expect(calls.some(c => c.includes('--add-label') && c.includes('"merged"'))).toBe(true);
    });

    it('calls gh issue edit to remove workflow labels that are present on the issue', async () => {
      mockExecAsync.mockImplementation(async (command: string) => {
        if (command.includes('gh issue view') && command.includes('--json labels')) {
          return { stdout: 'in-review\nin-progress\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      await cleanupMergedLabels(ctx);

      const calls = mockExecAsync.mock.calls.map((c: any[]) => c[0] as string);
      const removeCalls = calls.filter(c => c.includes('--remove-label'));
      expect(removeCalls.length).toBe(2);
      expect(removeCalls).toEqual(
        expect.arrayContaining([
          expect.stringContaining('"in-review"'),
          expect.stringContaining('"in-progress"'),
        ]),
      );
    });

    it('returns stepFailed when gh CLI throws', async () => {
      mockExecAsync.mockRejectedValue(new Error('gh: command not found'));

      const result = await cleanupMergedLabels(ctx);

      expect(result.step).toBe('label-cleanup:merged');
      expect(result.success).toBe(false);
      expect(result.error).toContain('gh: command not found');
    });
  });

  describe('Linear', () => {
    const ctx = { issueId: 'PAN-338', projectPath: '/tmp/test' };

    /** Minimal mock for a Linear issue node */
    function makeIssueNode(labelNames: string[] = ['in-review', 'in-progress']) {
      return {
        update: mockIssueUpdate,
        labels: mockIssueLabels.mockResolvedValue({
          nodes: labelNames.map((name, i) => ({ id: `label-${i}`, name })),
        }),
      };
    }

    beforeEach(() => {
      mockGetLinearApiKey.mockReturnValue('test-linear-key');
    });

    it('applies merged label and removes workflow labels (happy path)', async () => {
      mockClientIssues.mockResolvedValue({ nodes: [makeIssueNode()] });
      mockClientIssueLabels.mockResolvedValue({ nodes: [{ id: 'merged-label-id', name: 'merged' }] });

      const result = await cleanupMergedLabels(ctx);

      expect(result.step).toBe('label-cleanup:merged');
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.details?.some(d => d.includes('merged'))).toBe(true);
      // update() was called with labelIds that include the merged label
      expect(mockIssueUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ labelIds: expect.arrayContaining(['merged-label-id']) }),
      );
    });

    it('creates merged label when it does not exist', async () => {
      mockClientIssues.mockResolvedValue({ nodes: [makeIssueNode()] });
      mockClientIssueLabels.mockResolvedValue({ nodes: [] }); // label doesn't exist
      mockClientCreateIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: 'new-merged-id' }),
      });

      const result = await cleanupMergedLabels(ctx);

      expect(result.success).toBe(true);
      expect(mockClientCreateIssueLabel).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'merged' }),
      );
      expect(mockIssueUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ labelIds: expect.arrayContaining(['new-merged-id']) }),
      );
    });

    it('returns skipped when issue not found in Linear', async () => {
      mockClientIssues.mockResolvedValue({ nodes: [] });

      const result = await cleanupMergedLabels(ctx);

      expect(result.step).toBe('label-cleanup:merged');
      expect(result.skipped).toBe(true);
    });

    it('returns stepFailed when Linear SDK throws', async () => {
      mockClientIssues.mockRejectedValue(new Error('Linear API error'));

      const result = await cleanupMergedLabels(ctx);

      expect(result.step).toBe('label-cleanup:merged');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Linear API error');
    });

    it('strips workflow labels from existing label IDs before applying merged', async () => {
      makeIssueNode(['in-review', 'in-progress', 'merge-agent', 'bug']);
      mockClientIssues.mockResolvedValue({
        nodes: [makeIssueNode(['in-review', 'in-progress', 'merge-agent', 'bug'])],
      });
      mockClientIssueLabels.mockResolvedValue({ nodes: [{ id: 'merged-id', name: 'merged' }] });

      await cleanupMergedLabels(ctx);

      const updateArg = mockIssueUpdate.mock.calls[0][0];
      const labelIds: string[] = updateArg.labelIds;
      // bug label should survive, workflow labels should not
      expect(labelIds).toContain('merged-id');
      // in-review, in-progress, merge-agent nodes had ids label-0, label-1, label-2
      expect(labelIds).not.toContain('label-0'); // in-review
      expect(labelIds).not.toContain('label-1'); // in-progress
      expect(labelIds).not.toContain('label-2'); // merge-agent
      expect(labelIds).toContain('label-3');     // bug — preserved
    });
  });

  describe('no tracker', () => {
    it('returns skipped when no GitHub context and no Linear key', async () => {
      const ctx = { issueId: 'PAN-338', projectPath: '/tmp/test' };

      const result = await cleanupMergedLabels(ctx);

      expect(result.step).toBe('label-cleanup:merged');
      expect(result.skipped).toBe(true);
    });
  });
});
