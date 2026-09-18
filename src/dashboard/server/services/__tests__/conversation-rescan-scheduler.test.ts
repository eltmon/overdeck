import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The scheduler imports scan() directly; mock the module so no DB or
// filesystem is touched. Reset modules between tests so the module-level
// singleton state (timers, running flag) starts clean.
vi.mock('../../../../lib/conversations/scanner.js', () => ({
  scan: vi.fn().mockResolvedValue({ inserted: 0, updated: 0, skipped: 0, errors: 0, durationMs: 12 }),
}));

describe('conversation rescan scheduler', () => {
  let startConversationRescanScheduler: typeof import('../conversation-rescan-scheduler.js').startConversationRescanScheduler;
  let stopConversationRescanScheduler: typeof import('../conversation-rescan-scheduler.js').stopConversationRescanScheduler;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.resetModules();
    ({ startConversationRescanScheduler, stopConversationRescanScheduler } = await import('../conversation-rescan-scheduler.js'));
  });

  afterEach(async () => {
    await stopConversationRescanScheduler();
    vi.useRealTimers();
  });

  const getScan = async () => {
    const scanner = await import('../../../../lib/conversations/scanner.js');
    return vi.mocked(scanner.scan);
  };

  it('runs a boot pass after the startup delay and then on the interval', async () => {
    const scan = await getScan();
    startConversationRescanScheduler();

    expect(scan).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(45_000);
    expect(scan).toHaveBeenCalledTimes(1);

    // 6h interval: first tick at +6h after start.
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('skips a run when the previous one is still in flight', async () => {
    const scanner = await import('../../../../lib/conversations/scanner.js');
    let releaseScan: (() => void) | null = null;
    vi.mocked(scanner.scan).mockImplementationOnce(() => new Promise((resolve) => {
      releaseScan = () => resolve({ inserted: 1, updated: 0, skipped: 0, errors: 0, durationMs: 5 });
    }));

    startConversationRescanScheduler();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(vi.mocked(scanner.scan)).toHaveBeenCalledTimes(1);

    // Interval fires while the first pass is still pending.
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(vi.mocked(scanner.scan)).toHaveBeenCalledTimes(1);

    releaseScan?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(releaseScan).not.toBeNull();
  });

  it('survives a failing scan and keeps the schedule', async () => {
    const scanner = await import('../../../../lib/conversations/scanner.js');
    vi.mocked(scanner.scan).mockRejectedValueOnce(new Error('db locked'));

    startConversationRescanScheduler();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(vi.mocked(scanner.scan)).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(vi.mocked(scanner.scan)).toHaveBeenCalledTimes(2);
  });
});
