import { describe, expect, it, vi } from 'vitest';

const writeFileMock = vi.fn().mockResolvedValue(undefined);
const writeFileSyncMock = vi.fn();
const unlinkMock = vi.fn().mockResolvedValue(undefined);
const unlinkSyncMock = vi.fn();
const execFileMock = vi.fn((file: string, args: string[], options: unknown, callback?: (error: Error | null, stdout: string, stderr: string) => void) => {
  const done = typeof options === 'function' ? options : callback;
  done?.(null, '', '');
});
const execSyncMock = vi.fn();
const execFileSyncMock = vi.fn();

vi.mock('fs', () => ({
  writeFileSync: writeFileSyncMock,
  chmodSync: vi.fn(),
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  unlinkSync: unlinkSyncMock,
}));

vi.mock('fs/promises', () => ({
  writeFile: writeFileMock,
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: unlinkMock,
}));

vi.mock('child_process', () => ({
  execSync: execSyncMock,
  execFileSync: execFileSyncMock,
  execFile: execFileMock,
}));

vi.mock('../../../src/lib/config-yaml.js', () => ({
  loadConfig: () => ({ config: { tmux: { configMode: 'managed' } } }),
}));

describe('tmux send helpers', () => {
  it('uses a unique temp file path for concurrent async sends in the same millisecond', async () => {
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

  it('uses a unique temp file path for consecutive sync sends in the same millisecond', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T14:36:45.000Z'));

    const { sendKeys } = await import('../../../src/lib/tmux.js');

    sendKeys('session-a', 'first message');
    sendKeys('session-b', 'second message');

    const tempPaths = writeFileSyncMock.mock.calls
      .map(([filePath]) => String(filePath))
      .filter((filePath) => filePath.includes('pan-sendkeys-'));

    expect(tempPaths).toHaveLength(2);
    expect(new Set(tempPaths).size).toBe(2);

    vi.useRealTimers();
  });
});
