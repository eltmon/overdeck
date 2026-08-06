import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasDurableReviewPipelineHandler,
  registerDurableReviewDispatcher,
  registerDurableReviewPipelineHandler,
  startRegisteredDurableReviewPipelineHostSide,
} from '../durable-review-pipeline.js';
import { dispatchReviewHostSide } from '../../review-status.js';

describe.sequential('durable review pipeline handler registration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports no handler before the dashboard registers one', () => {
    expect(hasDurableReviewPipelineHandler()).toBe(false);
  });

  it('skips host-side dispatch without logging an unavailable pipeline', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    await dispatchReviewHostSide('PAN-3187');
    await dispatchReviewHostSide('PAN-3187');

    expect(log).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('reports a registered handler', () => {
    registerDurableReviewPipelineHandler(async () => true);

    expect(hasDurableReviewPipelineHandler()).toBe(true);
  });

  it('injects the registered dispatcher into host-side pipeline input', async () => {
    const dispatchReview = vi.fn(async () => ({ success: true }));
    registerDurableReviewDispatcher(dispatchReview);
    registerDurableReviewPipelineHandler(async (input) => {
      const result = await input.dispatchReview({
        issueId: input.issueId,
        workspace: '/workspace',
        branch: 'feature/pan-3187',
      });
      return result.success;
    });

    await expect(startRegisteredDurableReviewPipelineHostSide({
      issueId: 'PAN-3187',
      setReviewPending: vi.fn(),
    })).resolves.toBe(true);
    expect(dispatchReview).toHaveBeenCalledWith({
      issueId: 'PAN-3187',
      workspace: '/workspace',
      branch: 'feature/pan-3187',
    });
  });
});
