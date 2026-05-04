/**
 * Tests for `pan review reset` command.
 *
 * Regression: the --session flag previously REPLACED the review reset with
 * resetSessionCommand. It must be ADDITIVE — review is always reset; --session
 * also clears the Claude session.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { resetSessionMock, fetchMock } = vi.hoisted(() => ({
  resetSessionMock: vi.fn().mockResolvedValue(undefined),
  fetchMock: vi.fn(),
}));

vi.mock('../../../src/cli/commands/reset-session.js', () => ({
  resetSessionCommand: resetSessionMock,
}));

import { resetReviewCommand } from '../../../src/cli/commands/reset-review.js';

describe('resetReviewCommand (pan review reset)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'Reset complete', queued: false }),
    });
  });

  it('default (no flags): resets review only', async () => {
    await resetReviewCommand('PAN-1');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/review/PAN-1/reset'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(resetSessionMock).not.toHaveBeenCalled();
  });

  it('--session: resets review but rejects session reset with error', async () => {
    await expect(resetReviewCommand('PAN-2', { session: true })).rejects.toThrow('process.exit unexpectedly called with "1"');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/review/PAN-2/reset'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(resetSessionMock).not.toHaveBeenCalled();
  });

  it('session: false behaves like default', async () => {
    await resetReviewCommand('PAN-4', { session: false });
    expect(resetSessionMock).not.toHaveBeenCalled();
  });
});
