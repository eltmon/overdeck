/**
 * Tests for `pan review reset` action.
 *
 * Regression: the --session flag previously REPLACED resetReviewCommand with
 * resetSessionCommand. It must be ADDITIVE — review is always reset; --session
 * also clears the Claude session.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { resetReviewMock, resetSessionMock } = vi.hoisted(() => ({
  resetReviewMock: vi.fn().mockResolvedValue(undefined),
  resetSessionMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/cli/commands/reset-review.js', () => ({
  resetReviewCommand: resetReviewMock,
}));
vi.mock('../../../src/cli/commands/reset-session.js', () => ({
  resetSessionCommand: resetSessionMock,
}));

import { reviewResetAction } from '../../../src/cli/actions/review-reset.js';

describe('reviewResetAction (pan review reset)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('default (no flags): runs ONLY resetReviewCommand', async () => {
    await reviewResetAction('PAN-1');
    expect(resetReviewMock).toHaveBeenCalledWith('PAN-1');
    expect(resetSessionMock).not.toHaveBeenCalled();
  });

  it('--session: runs BOTH resetReviewCommand AND resetSessionCommand', async () => {
    await reviewResetAction('PAN-2', { session: true });
    expect(resetReviewMock).toHaveBeenCalledWith('PAN-2');
    expect(resetSessionMock).toHaveBeenCalledWith('PAN-2');
  });

  it('--session: review reset runs first, then session reset', async () => {
    const callOrder: string[] = [];
    resetReviewMock.mockImplementation(async () => { callOrder.push('review'); });
    resetSessionMock.mockImplementation(async () => { callOrder.push('session'); });

    await reviewResetAction('PAN-3', { session: true });

    expect(callOrder).toEqual(['review', 'session']);
  });

  it('session: false behaves like default', async () => {
    await reviewResetAction('PAN-4', { session: false });
    expect(resetReviewMock).toHaveBeenCalledWith('PAN-4');
    expect(resetSessionMock).not.toHaveBeenCalled();
  });
});
