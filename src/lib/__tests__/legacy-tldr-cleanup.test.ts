import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findLegacyTldrCheckouts, stopLegacyTldrDaemons } from '../legacy-tldr-cleanup.js';

// PAN-4429: dashboard boot stops TLDR daemons left by older installs, and only
// when the pid still belongs to a tldr process.

describe('stopLegacyTldrDaemons', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-legacy-tldr-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function checkoutWithPidfile(name: string, content: string | null): string {
    const dir = join(root, name);
    mkdirSync(join(dir, '.tldr'), { recursive: true });
    if (content !== null) writeFileSync(join(dir, '.tldr', 'daemon.pid'), content);
    return dir;
  }

  it('sends SIGTERM to a live pid whose command line contains tldr', async () => {
    const checkout = checkoutWithPidfile('a', '4242\n');
    const kill = vi.fn();
    const readCmdline = vi.fn(async () => '/ws/.venv/bin/python /ws/.venv/bin/tldr daemon start');

    const pids = await stopLegacyTldrDaemons([checkout], { kill, readCmdline });

    expect(pids).toEqual([4242]);
    expect(kill).toHaveBeenCalledWith(4242, 0);
    expect(kill).toHaveBeenCalledWith(4242, 'SIGTERM');
  });

  it('leaves a live pid alone when its command line lacks tldr (pid reuse)', async () => {
    const checkout = checkoutWithPidfile('a', '4242');
    const kill = vi.fn();

    const pids = await stopLegacyTldrDaemons([checkout], { kill, readCmdline: async () => 'node server.js' });

    expect(pids).toEqual([]);
    expect(kill).not.toHaveBeenCalledWith(4242, 'SIGTERM');
  });

  it('leaves a dead pid alone', async () => {
    const checkout = checkoutWithPidfile('a', '4242');
    const kill = vi.fn((_pid: number, signal?: NodeJS.Signals | 0) => {
      if (signal === 0) throw new Error('ESRCH');
    });
    const readCmdline = vi.fn(async () => 'tldr daemon');

    const pids = await stopLegacyTldrDaemons([checkout], { kill, readCmdline });

    expect(pids).toEqual([]);
    expect(readCmdline).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalledWith(4242, 'SIGTERM');
  });

  it('ignores a missing or garbage pidfile', async () => {
    const missing = checkoutWithPidfile('missing', null);
    const garbage = checkoutWithPidfile('garbage', 'not-a-pid');
    const kill = vi.fn();

    const pids = await stopLegacyTldrDaemons([missing, garbage, join(root, 'no-such-dir')], {
      kill,
      readCmdline: async () => 'tldr daemon',
    });

    expect(pids).toEqual([]);
    expect(kill).not.toHaveBeenCalled();
  });
});

describe('findLegacyTldrCheckouts', () => {
  it('returns only checkouts that contain a .tldr/ directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-legacy-tldr-find-'));
    try {
      const withDir = join(root, 'with');
      const withFile = join(root, 'file');
      const without = join(root, 'without');
      mkdirSync(join(withDir, '.tldr'), { recursive: true });
      mkdirSync(withFile, { recursive: true });
      writeFileSync(join(withFile, '.tldr'), '');
      mkdirSync(without, { recursive: true });

      expect(findLegacyTldrCheckouts([withDir, withFile, without])).toEqual([withDir]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
