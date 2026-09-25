import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMocks }));

import { pauseOutcomeNotice, toastPauseOutcome, unpauseOutcomeNotice } from './pauseOutcome';

describe('pause and unpause outcome notices (PAN-3911)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('warns with the pause warnings instead of reporting a clean pause', () => {
    const notice = pauseOutcomeNotice('PAN-1', {
      warnings: ['could not stop agent-pan-1-review-security: herdr could not close pane p_9'],
    });

    expect(notice).toEqual({
      level: 'warning',
      title: 'PAN-1 paused, with problems',
      description: 'could not stop agent-pan-1-review-security: herdr could not close pane p_9',
    });
    toastPauseOutcome(notice);
    expect(toastMocks.warning).toHaveBeenCalledWith('PAN-1 paused, with problems', { description: notice.description });
    expect(toastMocks.success).not.toHaveBeenCalled();
  });

  it('is a clean pause when the route reports no warnings', () => {
    expect(pauseOutcomeNotice('PAN-1', { warnings: [] })).toEqual({ level: 'success', title: 'PAN-1 paused' });
  });

  it('warns when the review re-request after unpause did not go out', () => {
    const notice = unpauseOutcomeNotice('PAN-1', {
      resumeTriggered: true,
      restart: { review: { requested: false, reason: 'working tree is dirty' } },
      warnings: ['review not re-requested: working tree is dirty'],
    });

    expect(notice).toEqual({
      level: 'warning',
      title: 'PAN-1 unpaused — resuming now',
      description: 'review not re-requested: working tree is dirty',
    });
  });

  it('says when the review was re-requested, and when none was needed', () => {
    expect(unpauseOutcomeNotice('PAN-1', { restart: { review: { requested: true } } })).toEqual({
      level: 'success',
      title: 'PAN-1 unpaused',
      description: 'Review re-requested: the pause had stopped it.',
    });
    expect(unpauseOutcomeNotice('PAN-1', {
      restart: { review: { requested: false, noReviewNeeded: true, reason: 'the PR is approved at its current head' } },
    })).toEqual({
      level: 'success',
      title: 'PAN-1 unpaused',
      description: 'No review re-requested: the PR is approved at its current head',
    });
  });

  it('is a plain unpause when the pause stopped nothing', () => {
    expect(unpauseOutcomeNotice('PAN-1', { resumeTriggered: false })).toEqual({ level: 'success', title: 'PAN-1 unpaused' });
  });
});
