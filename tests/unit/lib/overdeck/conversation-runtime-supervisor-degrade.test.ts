import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { statMock, capturePaneTextMock } = vi.hoisted(() => ({
  statMock: vi.fn(),
  capturePaneTextMock: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  stat: statMock,
}));

vi.mock('../../../../src/lib/tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/tmux.js')>()),
  capturePaneText: capturePaneTextMock,
}));

const { waitForPtySupervisorOrFallback } = await import(
  '../../../../src/lib/overdeck/conversation-runtime.js'
);

describe('PTY supervisor timeout degradation', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    vi.useFakeTimers();
    statMock.mockRejectedValue(new Error('ENOENT'));
    capturePaneTextMock.mockResolvedValue('healthy harness statusline');
    warnSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('continues with fallback delivery while the tmux session is alive', async () => {
    const result = waitForPtySupervisorOrFallback('conv-live', 250, vi.fn().mockResolvedValue(true));
    await vi.advanceTimersByTimeAsync(250);

    await expect(result).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('continuing with fallback delivery'));
  });

  it('propagates the timeout after the tmux session dies', async () => {
    const result = waitForPtySupervisorOrFallback('conv-dead', 250, vi.fn().mockResolvedValue(false));
    const errorPromise = result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(250);

    const error = await errorPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Timed out waiting for PTY supervisor socket');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
