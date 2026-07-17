import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('removes the partial destination when an active file copy is aborted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-state-file-copy-'));
    const source = join(root, 'source.bin');
    const destination = join(root, 'destination', 'copy.bin');
    writeFileSync(source, '');
    truncateSync(source, 64 * 1024 * 1024);
    const controller = new AbortController();
    const reason = new Error('state reconciliation timed out');

    try {
      const copy = __testInternals.copyFileAbortable(source, destination, controller.signal);
      const rejection = expect(copy).rejects.toBe(reason);
      controller.abort(reason);

      await rejection;
      expect(existsSync(destination)).toBe(false);
      expect(readdirSync(join(root, 'destination'))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('cancels an active legacy file copy at the reconciliation deadline', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pan-state-copy-source-'));
    const stateRoot = mkdtempSync(join(tmpdir(), 'pan-state-copy-destination-'));
    const sourceFile = join(sourceRoot, '.pan', 'records', 'pan-test.json');
    mkdirSync(join(sourceRoot, '.pan', 'records'), { recursive: true });
    writeFileSync(sourceFile, '{}');
    const controller = new AbortController();
    const reason = new Error('state reconciliation timed out');
    let markCopyStarted!: () => void;
    const copyStarted = new Promise<void>((resolve) => { markCopyStarted = resolve; });
    const copyFile = vi.fn((
      _source: string,
      _destination: string,
      signal?: AbortSignal,
    ) => new Promise<void>((_resolve, reject) => {
      markCopyStarted();
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));

    try {
      const copy = __testInternals.copyLegacyState(
        sourceRoot,
        stateRoot,
        controller.signal,
        copyFile,
      );
      setTimeout(() => controller.abort(reason), 60_000);
      await copyStarted;
      const rejection = expect(copy).rejects.toBe(reason);

      await vi.advanceTimersByTimeAsync(60_000);

      expect(controller.signal.aborted).toBe(true);
      await rejection;
      expect(copyFile).toHaveBeenCalledWith(
        sourceFile,
        join(stateRoot, 'records', 'pan-test.json'),
        controller.signal,
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });
});
