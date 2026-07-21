import { describe, expect, it, vi } from 'vitest';
import { shouldWarnNoMergeBackend, warnIfAutonomousMergeBackendUnavailable } from '../merge-backend-health.js';
import type { MergeBackendStatus } from '../../../../lib/github-app.js';

function backend(available: boolean): MergeBackendStatus {
  return {
    available,
    mode: available ? 'gh-cli' : 'none',
    detail: available ? 'gh CLI is authenticated' : 'No GitHub App credentials or gh CLI authentication found',
  };
}

describe('merge backend health', () => {
  it.each([
    { requireUat: false, available: false, expected: true },
    { requireUat: false, available: true, expected: false },
    { requireUat: true, available: false, expected: false },
    { requireUat: true, available: true, expected: false },
  ])('shouldWarnNoMergeBackend($requireUat, $available) returns $expected', ({ requireUat, available, expected }) => {
    expect(shouldWarnNoMergeBackend(requireUat, backend(available))).toBe(expected);
  });

  it('logs a multi-line autonomous merge warning when UAT is disabled and no backend is available', async () => {
    const warn = vi.fn();

    await warnIfAutonomousMergeBackendUnavailable({
      isRequireUatBeforeMerge: () => false,
      getStatus: async () => backend(false),
      warn,
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('autonomous merge backend is unavailable'));
    expect(warn.mock.calls[0][0]).toContain('\n');
    expect(warn.mock.calls[0][0]).toContain('manual dashboard MERGE button');
  });

  it('does not throw when the merge backend status check fails', async () => {
    const warn = vi.fn();

    await expect(warnIfAutonomousMergeBackendUnavailable({
      isRequireUatBeforeMerge: () => false,
      getStatus: async () => { throw new Error('gh timed out'); },
      warn,
    })).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith('[overdeck] WARNING: failed to check autonomous merge backend: gh timed out');
  });
});
