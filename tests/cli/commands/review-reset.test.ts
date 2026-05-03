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

  it('--session: errors out instead of clearing session', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    await expect(resetReviewCommand('PAN-2', { session: true })).rejects.toThrow('process.exit called');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/review/PAN-2/reset'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(resetSessionMock).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('--session: review reset runs before the session error', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const callOrder: string[] = [];
    fetchMock.mockImplementation(async () => {
      callOrder.push('review');
      return {
        ok: true,
        json: async () => ({ success: true, message: 'Reset complete', queued: false }),
      };
    });

    await expect(resetReviewCommand('PAN-3', { session: true })).rejects.toThrow('process.exit called');

    expect(callOrder).toEqual(['review']);
    expect(resetSessionMock).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('session: false behaves like default', async () => {
    await resetReviewCommand('PAN-4', { session: false });
    expect(resetSessionMock).not.toHaveBeenCalled();
  });
});
