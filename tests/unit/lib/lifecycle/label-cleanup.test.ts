import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use vi.hoisted to avoid initialization order issues
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
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

// Default: no Linear API key
vi.mock('../../../../src/lib/lifecycle/types.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/lifecycle/types.js')>();
  return {
    ...actual,
    getLinearApiKey: vi.fn().mockReturnValue(null),
  };
});

import { cleanupMergedLabels } from '../../../../src/lib/lifecycle/label-cleanup.js';

describe('cleanupMergedLabels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GitHub', () => {
    const ctx = {
      issueId: 'PAN-338',
      projectPath: '/tmp/test',
      github: { owner: 'eltmon', repo: 'panopticon-cli', number: 338 },
    };

    it('returns ok with merged label applied', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await cleanupMergedLabels(ctx);

      expect(result.step).toBe('label-cleanup:merged');
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.details?.some(d => d.includes('merged'))).toBe(true);
    });

    it('calls gh label create to ensure merged label exists', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await cleanupMergedLabels(ctx);

      const calls = mockExecAsync.mock.calls.map((c: any[]) => c[0] as string);
      expect(calls.some(c => c.includes('gh label create') && c.includes('"merged"'))).toBe(true);
    });

    it('calls gh issue edit to add merged label', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await cleanupMergedLabels(ctx);

      const calls = mockExecAsync.mock.calls.map((c: any[]) => c[0] as string);
      expect(calls.some(c => c.includes('--add-label') && c.includes('"merged"'))).toBe(true);
    });

    it('calls gh issue edit to remove workflow labels', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await cleanupMergedLabels(ctx);

      const calls = mockExecAsync.mock.calls.map((c: any[]) => c[0] as string);
      const removeCalls = calls.filter(c => c.includes('--remove-label'));
      expect(removeCalls.length).toBeGreaterThan(0);
      expect(removeCalls.some(c => c.includes('"in-review"') || c.includes('"in-progress"') || c.includes('"merge-agent"'))).toBe(true);
    });

    it('returns stepFailed when gh CLI throws', async () => {
      mockExecAsync.mockRejectedValue(new Error('gh: command not found'));

      const result = await cleanupMergedLabels(ctx);

      expect(result.step).toBe('label-cleanup:merged');
      expect(result.success).toBe(false);
      expect(result.error).toContain('gh: command not found');
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
