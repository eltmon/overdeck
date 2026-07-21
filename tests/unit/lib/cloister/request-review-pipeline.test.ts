import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRequestReviewPipeline } from '../../../../src/lib/cloister/request-review-pipeline.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('request review pipeline', () => {
  it('returns immediately while verification continues, then pushes before dispatch', async () => {
    vi.useFakeTimers();
    const pipeline = createRequestReviewPipeline();
    const order: string[] = [];
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });

    const started = pipeline.start('PAN-2819', {
      verify: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 10 * 60 * 1000));
        order.push('verified');
        return { outcome: 'passed' };
      },
      pushBranch: async () => { order.push('pushed'); },
      dispatchReview: async () => {
        order.push('dispatched');
        finish();
      },
      onVerificationFailed: vi.fn(),
      onVerificationError: vi.fn(),
    });

    expect(started).toBe(true);
    expect(pipeline.isInFlight('PAN-2819')).toBe(true);
    expect(order).toEqual([]);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await finished;

    expect(order).toEqual(['verified', 'pushed', 'dispatched']);
    expect(pipeline.isInFlight('PAN-2819')).toBe(false);
  });

  it('coalesces repeated requests while verification is active', async () => {
    vi.useFakeTimers();
    const pipeline = createRequestReviewPipeline();
    const verify = vi.fn(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 60_000));
      return { outcome: 'passed' as const };
    });
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const deps = {
      verify,
      pushBranch: vi.fn(async () => {}),
      dispatchReview: vi.fn(async () => { finish(); }),
      onVerificationFailed: vi.fn(),
      onVerificationError: vi.fn(),
    };

    expect(pipeline.start('PAN-2819', deps)).toBe(true);
    expect(pipeline.start('PAN-2819', deps)).toBe(false);
    expect(verify).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await finished;

    expect(deps.pushBranch).toHaveBeenCalledTimes(1);
    expect(deps.dispatchReview).toHaveBeenCalledTimes(1);
  });

  it('records failed verification without pushing or dispatching review', async () => {
    const pipeline = createRequestReviewPipeline();
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const onVerificationFailed = vi.fn(() => { finish(); });
    const pushBranch = vi.fn(async () => {});
    const dispatchReview = vi.fn(async () => {});

    pipeline.start('PAN-2819', {
      verify: async () => ({
        outcome: 'failed',
        failedCheck: 'test',
        cycleCount: 1,
        maxCycles: 3,
      }),
      pushBranch,
      dispatchReview,
      onVerificationFailed,
      onVerificationError: vi.fn(),
    });
    await finished;

    expect(onVerificationFailed).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failed',
      failedCheck: 'test',
    }));
    expect(pushBranch).not.toHaveBeenCalled();
    expect(dispatchReview).not.toHaveBeenCalled();
  });

  it('does not dispatch when the verified branch cannot be pushed', async () => {
    const pipeline = createRequestReviewPipeline();
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const dispatchReview = vi.fn(async () => {});
    const onError = vi.fn(() => { finish(); });

    pipeline.start('PAN-2819', {
      verify: async () => ({ outcome: 'passed' }),
      pushBranch: async () => { throw new Error('push failed'); },
      dispatchReview,
      onVerificationFailed: vi.fn(),
      onVerificationError: vi.fn(),
      onError,
    });
    await finished;

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'push failed' }));
    expect(dispatchReview).not.toHaveBeenCalled();
  });
});
