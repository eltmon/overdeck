import { describe, expect, it, vi } from 'vitest';

const writeFileMock = vi.fn().mockResolvedValue(undefined);
const unlinkMock = vi.fn().mockResolvedValue(undefined);
const execFileMock = vi.fn((file: string, args: string[], options: unknown, callback?: (error: Error | null, stdout: string, stderr: string) => void) => {
  const done = typeof options === 'function' ? options : callback;
  done?.(null, '', '');
});

vi.mock('fs/promises', () => ({
  writeFile: writeFileMock,
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: unlinkMock,
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
  execFile: execFileMock,
}));

vi.mock('../../../src/lib/config-yaml.js', () => ({
  loadConfig: () => ({ config: { tmux: { configMode: 'managed' } } }),
}));

describe('sendKeysAsync', () => {
  it('uses a unique temp file path for concurrent sends in the same millisecond', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T14:36:45.000Z'));

    const { sendKeysAsync } = await import('../../../src/lib/tmux.js');

    const sendPromise = Promise.all([
      sendKeysAsync('session-a', 'first message'),
      sendKeysAsync('session-b', 'second message'),
    ]);

    await vi.runAllTimersAsync();
    await sendPromise;

    const tempPaths = writeFileMock.mock.calls
      .map(([filePath]) => String(filePath))
      .filter((filePath) => filePath.includes('pan-sendkeys-'));

    expect(tempPaths).toHaveLength(2);
    expect(new Set(tempPaths).size).toBe(2);

    vi.useRealTimers();
  });
});
