import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));

vi.mock('node:child_process', () => ({ execFile }));

import { __testInternals } from '../../../src/cli/commands/admin/state-migrate.js';

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

describe('state migration Git command cancellation', () => {
  let callback: ExecCallback;
  let processKill: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    execFile.mockReset();
    execFile.mockImplementation((_file, _args, _options, cb: ExecCallback) => {
      callback = cb;
      return { pid: 4321, kill: vi.fn() };
    });
    processKill = vi.spyOn(process, 'kill').mockReturnValue(true);
  });

  afterEach(() => {
    processKill.mockRestore();
    vi.useRealTimers();
  });

  it('kills the Git process group at its deadline and waits for process settlement', async () => {
    let settled = false;
    const command = __testInternals.git('/repo', ['fetch', 'origin']);
    void command.then(() => { settled = true; }, () => { settled = true; });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(processKill).toHaveBeenCalledWith(-4321, 'SIGKILL');
    expect(settled).toBe(false);
    callback(null, '', '');
    await expect(command).rejects.toThrow('git fetch origin timed out after 30s');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('kills the Git process group on abort and waits for process settlement', async () => {
    const controller = new AbortController();
    const reason = new Error('state reconciliation timed out');
    let settled = false;
    const command = __testInternals.git('/repo', ['status'], controller.signal);
    void command.then(() => { settled = true; }, () => { settled = true; });

    controller.abort(reason);

    expect(processKill).toHaveBeenCalledWith(-4321, 'SIGKILL');
    expect(settled).toBe(false);
    callback(null, '', '');
    await expect(command).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });
});
