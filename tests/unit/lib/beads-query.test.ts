import { mkdirSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

vi.mock('child_process', () => childProcessMocks);

const originalPanopticonHome = process.env.PANOPTICON_HOME;
let testRoot: string;
let workspacePath: string;

describe('queryBeadsForIssuePromise', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    testRoot = await mkdtemp(join(tmpdir(), 'pan-beads-query-'));
    workspacePath = join(testRoot, 'workspace');
    mkdirSync(join(workspacePath, '.beads'), { recursive: true });
    process.env.PANOPTICON_HOME = join(testRoot, 'home');
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalPanopticonHome === undefined) {
      delete process.env.PANOPTICON_HOME;
    } else {
      process.env.PANOPTICON_HOME = originalPanopticonHome;
    }
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('retries transient bd lock failures before jsonl fallback', async () => {
    vi.useFakeTimers();
    childProcessMocks.execFile.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(new Error('database is locked'), '', 'database is locked');
    });
    childProcessMocks.execFile.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(null, { stdout: JSON.stringify([{ id: 'panopticon-1', title: 'PAN-1094: Task', status: 'open', labels: ['pan-1094'] }]) }, '');
    });
    const { queryBeadsForIssuePromise } = await import('../../../src/lib/beads-query.js');

    await expect(queryBeadsForIssuePromise(workspacePath, 'PAN-1094', {
      maxAttempts: 2,
      initialDelayMs: 100,
      maxDelayMs: 100,
      random: () => 0,
      sleep: (ms) => vi.advanceTimersByTimeAsync(ms),
    })).resolves.toEqual([
      { id: 'panopticon-1', title: 'PAN-1094: Task', status: 'open', labels: ['pan-1094'] },
    ]);
    expect(childProcessMocks.execFile).toHaveBeenCalledTimes(2);
  });
});
