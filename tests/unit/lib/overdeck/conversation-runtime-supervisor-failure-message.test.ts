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

const {
  extractSupervisorFailure,
  waitForPtySupervisorSocket,
} = await import('../../../../src/lib/overdeck/conversation-runtime.js');

describe('PTY supervisor failure messages', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    statMock.mockRejectedValue(new Error('ENOENT'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns null for a healthy harness statusline', () => {
    expect(extractSupervisorFailure('ctx 0% 0/1.0M out 0 cost $0.0000 | manual mode on')).toBeNull();
  });

  it('returns error-shaped lines from a failed supervisor pane', () => {
    const failure = extractSupervisorFailure(
      "starting\nError [ERR_MODULE_NOT_FOUND]: Cannot find package '@lydell/node-pty'\n",
    );
    expect(failure).toContain('ERR_MODULE_NOT_FOUND');
    expect(failure).toContain('@lydell/node-pty');
  });

  it('describes a healthy pane without quoting its statusline as failure output', async () => {
    const statusline = 'ctx 0% 0/1.0M out 0 cost $0.0000 | manual mode on';
    capturePaneTextMock.mockResolvedValue(statusline);
    const errorPromise = waitForPtySupervisorSocket('conv-test', 250).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(250);

    const error = await errorPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('no error output');
    expect((error as Error).message).not.toContain(statusline);
  });
});
