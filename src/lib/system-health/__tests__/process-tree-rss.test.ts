import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readProcessTreeRssBytes,
  startPeakRssSampler,
  type ProcReader,
} from '../process-tree-rss.js';

interface FakeProc {
  comm?: string;
  ppid: number;
  rssKb?: number;
}

function fakeReader(procs: Record<number, FakeProc>, vanished: number[] = []): ProcReader & {
  statusReads: number[];
} {
  const statusReads: number[] = [];
  return {
    statusReads,
    async listPids() {
      return Object.keys(procs).map(Number);
    },
    async readStat(pid) {
      const proc = procs[pid];
      if (!proc) return null;
      return `${pid} (${proc.comm ?? 'node'}) S ${proc.ppid} ${pid} ${pid} 0 -1 4194304`;
    },
    async readStatus(pid) {
      statusReads.push(pid);
      const proc = procs[pid];
      if (!proc || vanished.includes(pid)) return null;
      const rss = proc.rssKb === undefined ? '' : `VmRSS:\t${proc.rssKb} kB\n`;
      return `Name:\t${proc.comm ?? 'node'}\nPPid:\t${proc.ppid}\n${rss}Threads:\t1\n`;
    },
  };
}

describe('readProcessTreeRssBytes (PAN-5248)', () => {
  it('sums VmRSS for the root and its descendants only', async () => {
    const reader = fakeReader({
      1: { ppid: 0, rssKb: 9_000 },
      100: { ppid: 1, rssKb: 1_000 },
      101: { ppid: 100, rssKb: 2_000 },
      102: { ppid: 101, rssKb: 3_000 },
      200: { ppid: 1, rssKb: 50_000 },
    });
    await expect(readProcessTreeRssBytes(100, reader, 'linux')).resolves.toBe(6_000 * 1024);
  });

  it('parses ppid when comm contains ") ("', async () => {
    const reader = fakeReader({
      100: { ppid: 1, rssKb: 1_000 },
      101: { ppid: 100, comm: 'evil) (S 1 2', rssKb: 4_000 },
    });
    await expect(readProcessTreeRssBytes(100, reader, 'linux')).resolves.toBe(5_000 * 1024);
  });

  it('skips a member whose status vanished mid-walk', async () => {
    const reader = fakeReader(
      {
        100: { ppid: 1, rssKb: 1_000 },
        101: { ppid: 100, rssKb: 2_000 },
        102: { ppid: 100, rssKb: 3_000 },
      },
      [101],
    );
    await expect(readProcessTreeRssBytes(100, reader, 'linux')).resolves.toBe(4_000 * 1024);
  });

  it('returns null when the root cannot be read', async () => {
    const reader = fakeReader({ 100: { ppid: 1, rssKb: 1_000 } });
    await expect(readProcessTreeRssBytes(999, reader, 'linux')).resolves.toBeNull();
  });

  it('returns null off Linux without reading /proc', async () => {
    const reader = fakeReader({ 100: { ppid: 1, rssKb: 1_000 } });
    const listPids = vi.spyOn(reader, 'listPids');
    await expect(readProcessTreeRssBytes(100, reader, 'darwin')).resolves.toBeNull();
    expect(listPids).not.toHaveBeenCalled();
    expect(reader.statusReads).toEqual([]);
  });
});

describe('startPeakRssSampler (PAN-5248)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the largest value read across ticks', async () => {
    const values = [100, 300, 200];
    const read = vi.fn(async () => values.shift() ?? null);
    const sampler = startPeakRssSampler(42, { intervalMs: 2000, read });
    await vi.advanceTimersByTimeAsync(4000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenCalledWith(42);
    await expect(sampler.stop()).resolves.toBe(300);
  });

  it('returns null when every read is null and stops reading after stop()', async () => {
    const read = vi.fn(async () => null);
    const sampler = startPeakRssSampler(42, { read });
    await vi.advanceTimersByTimeAsync(6000);
    await expect(sampler.stop()).resolves.toBeNull();
    const calls = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(calls);
  });

  it('awaits an in-flight read before returning', async () => {
    let resolveRead: (value: number) => void = () => undefined;
    const read = vi.fn(() => new Promise<number | null>((resolve) => { resolveRead = resolve; }));
    const sampler = startPeakRssSampler(42, { read });
    const stopped = sampler.stop();
    resolveRead(512);
    await expect(stopped).resolves.toBe(512);
  });
});
