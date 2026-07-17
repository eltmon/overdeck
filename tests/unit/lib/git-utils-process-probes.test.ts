import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const existsSyncMock = vi.hoisted(() => vi.fn());
const unlinkSyncMock = vi.hoisted(() => vi.fn());
const readdirSyncMock = vi.hoisted(() => vi.fn());
const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  unlinkSync: unlinkSyncMock,
  readdirSync: readdirSyncMock,
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: execFileMock,
}));

import { cleanupStaleLocks } from '../../../src/lib/git-utils.js';

const REPO_PATH = '/tmp/pan-1897-lock-probe';
const INDEX_LOCK = `${REPO_PATH}/.git/index.lock`;

type ProbeCallback = (
  error: (Error & { code?: number | string }) | null,
  stdout: string,
  stderr: string,
) => void;

function child(pid: number) {
  return { pid, kill: vi.fn() };
}

describe('git stale-lock process probes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    existsSyncMock.mockImplementation((path: string) => path === INDEX_LOCK);
    readdirSyncMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('kills a timed-out process probe and waits for its callback before reporting unsafe state', async () => {
    let finishProbe!: ProbeCallback;
    execFileMock.mockImplementation((
      _file: string,
      _args: string[],
      _options: Record<string, unknown>,
      callback: ProbeCallback,
    ) => {
      finishProbe = callback;
      return child(5151);
    });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    let settled = false;
    const cleanupPromise = Effect.runPromise(cleanupStaleLocks(REPO_PATH, {
      processProbeTimeoutMs: 1_000,
    }));
    void cleanupPromise.then(() => { settled = true; }, () => { settled = true; });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(killSpy).toHaveBeenCalledWith(-5151, 'SIGKILL');
    expect(settled).toBe(false);
    expect(unlinkSyncMock).not.toHaveBeenCalled();

    finishProbe(null, '', '');
    await expect(cleanupPromise).resolves.toEqual({
      found: [INDEX_LOCK],
      removed: [],
      errors: [{
        file: 'N/A',
        error: expect.stringContaining('fuser') as unknown as string,
      }],
    });
    expect(settled).toBe(true);
    expect(unlinkSyncMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    killSpy.mockRestore();
  });

  it('kills an aborted process probe and preserves the lock until the probe settles', async () => {
    let finishProbe!: ProbeCallback;
    execFileMock.mockImplementation((
      _file: string,
      _args: string[],
      _options: Record<string, unknown>,
      callback: ProbeCallback,
    ) => {
      finishProbe = callback;
      return child(6161);
    });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const controller = new AbortController();
    let settled = false;
    const cleanupPromise = Effect.runPromise(cleanupStaleLocks(REPO_PATH, {
      signal: controller.signal,
      processProbeTimeoutMs: 30_000,
    }));
    void cleanupPromise.then(() => { settled = true; }, () => { settled = true; });

    controller.abort();
    await Promise.resolve();

    expect(killSpy).toHaveBeenCalledWith(-6161, 'SIGKILL');
    expect(settled).toBe(false);
    finishProbe(null, '', '');

    await expect(cleanupPromise).resolves.toMatchObject({
      found: [INDEX_LOCK],
      removed: [],
      errors: [{ file: 'N/A', error: expect.stringContaining('cancelled') }],
    });
    expect(unlinkSyncMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    killSpy.mockRestore();
  });

  it('preserves locks when fuser finds an active Git process', async () => {
    execFileMock.mockImplementation((
      _file: string,
      _args: string[],
      _options: Record<string, unknown>,
      callback: ProbeCallback,
    ) => {
      callback(null, '4242\n', '');
      return child(4242);
    });

    await expect(Effect.runPromise(cleanupStaleLocks(REPO_PATH, {
      processProbeTimeoutMs: 2_000,
    }))).resolves.toEqual({
      found: [INDEX_LOCK],
      removed: [],
      errors: [{
        file: 'N/A',
        error: 'Git processes are running - not safe to remove locks',
      }],
    });
    expect(unlinkSyncMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the bounded ps fallback when fuser is unavailable', async () => {
    execFileMock
      .mockImplementationOnce((
        _file: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: ProbeCallback,
      ) => {
        callback(Object.assign(new Error('fuser missing'), { code: 'ENOENT' }), '', '');
        return child(7171);
      })
      .mockImplementationOnce((
        _file: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: ProbeCallback,
      ) => {
        callback(null, 'node server.js\n', '');
        return child(8181);
      });

    await expect(Effect.runPromise(cleanupStaleLocks(REPO_PATH, {
      processProbeTimeoutMs: 2_000,
    }))).resolves.toEqual({
      found: [INDEX_LOCK],
      removed: [INDEX_LOCK],
      errors: [],
    });
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      'ps',
      ['-eo', 'args='],
      expect.objectContaining({ detached: true }),
      expect.any(Function),
    );
    expect(unlinkSyncMock).toHaveBeenCalledWith(INDEX_LOCK);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves locks when the fallback probe cannot prove Git is idle', async () => {
    execFileMock
      .mockImplementationOnce((
        _file: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: ProbeCallback,
      ) => {
        callback(Object.assign(new Error('fuser missing'), { code: 127 }), '', '');
        return child(9191);
      })
      .mockImplementationOnce((
        _file: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: ProbeCallback,
      ) => {
        callback(new Error('ps failed'), '', '');
        return child(1010);
      });

    await expect(Effect.runPromise(cleanupStaleLocks(REPO_PATH, {
      processProbeTimeoutMs: 2_000,
    }))).resolves.toMatchObject({
      found: [INDEX_LOCK],
      removed: [],
      errors: [{ file: 'N/A', error: expect.stringContaining('ps failed') }],
    });
    expect(unlinkSyncMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
