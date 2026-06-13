import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFile: execFileMock,
  };
});

vi.mock('../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/config-yaml.js')>();
  return {
    ...actual,
    loadConfigSync: () => ({ config: { tmux: { configMode: 'inherit-user' } } }),
  };
});

describe('sendEscapeKeyAsync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    execFileMock.mockReset();
    execFileMock.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, '', '');
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends Escape to the exact pane target with 250ms gaps', async () => {
    const { sendEscapeKeyAsync } = await import('../../src/lib/tmux.js');

    const result = sendEscapeKeyAsync('agent-pan-1787', 2);
    await Promise.resolve();
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      'tmux',
      ['send-keys', '-t', '=agent-pan-1787:', 'Escape'],
      { encoding: 'utf-8' },
      expect.any(Function),
    );

    await vi.advanceTimersByTimeAsync(249);
    expect(execFileMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await result;

    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      'tmux',
      ['send-keys', '-t', '=agent-pan-1787:', 'Escape'],
      { encoding: 'utf-8' },
      expect.any(Function),
    );
  });
});
