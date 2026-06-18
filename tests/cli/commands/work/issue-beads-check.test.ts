/**
 * Tests for hasBeadsTasks — the beads enforcement check in pan start (PAN-336)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const childProcessMocks = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock('child_process', () => childProcessMocks);

let tmpDir: string;
const originalOverdeckHome = process.env.OVERDECK_HOME;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pan-issue-test-'));
  process.env.OVERDECK_HOME = join(tmpDir, '.panopticon-home');
  childProcessMocks.execFileSync.mockImplementation(() => {
    throw new Error('bd unavailable');
  });
});

afterEach(() => {
  vi.useRealTimers();
  if (originalOverdeckHome === undefined) {
    delete process.env.OVERDECK_HOME;
  } else {
    process.env.OVERDECK_HOME = originalOverdeckHome;
  }
  rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('hasBeadsTasks', () => {
  it('returns false when .beads directory does not exist', async () => {
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/start.js');
    expect(hasBeadsTasks(tmpDir, 'PAN-1094')).toBe(false);
  });

  it('returns false when .beads exists without exported issues', async () => {
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/start.js');
    mkdirSync(join(tmpDir, '.beads'));
    expect(hasBeadsTasks(tmpDir, 'PAN-1094')).toBe(false);
  });

  it('returns false when issues.jsonl only contains beads for another issue', async () => {
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/start.js');
    mkdirSync(join(tmpDir, '.beads'), { recursive: true });
    writeFileSync(join(tmpDir, '.beads', 'issues.jsonl'), JSON.stringify({
      id: 'panopticon-1',
      title: 'PAN-1093: Task',
      labels: ['pan-1093'],
    }) + '\n');

    expect(hasBeadsTasks(tmpDir, 'PAN-1094')).toBe(false);
  });

  it('returns true when issues.jsonl contains a bead labeled for the issue', async () => {
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/start.js');
    mkdirSync(join(tmpDir, '.beads'), { recursive: true });
    writeFileSync(join(tmpDir, '.beads', 'issues.jsonl'), JSON.stringify({
      id: 'panopticon-2',
      title: 'PAN-1094: Task',
      labels: ['pan-1094'],
    }) + '\n');

    expect(hasBeadsTasks(tmpDir, 'PAN-1094')).toBe(true);
  });

  it('returns true when bd reports a matching issue bead', async () => {
    childProcessMocks.execFileSync.mockImplementation(() => JSON.stringify([{ id: 'panopticon-3' }]));
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/start.js');

    expect(hasBeadsTasks(tmpDir, 'PAN-1094')).toBe(true);
    expect(childProcessMocks.execFileSync).toHaveBeenCalledWith(
      'bd',
      ['list', '--json', '-l', 'pan-1094', '--status', 'all', '--limit', '0'],
      expect.objectContaining({ cwd: tmpDir }),
    );
  });

  it('marks lock-contention failures as transient instead of genuine missing beads', async () => {
    childProcessMocks.execFileSync.mockImplementation(() => {
      throw { stderr: 'database is locked' };
    });
    const { countBeadsTasksDetailed } = await import('../../../../src/cli/commands/start.js');

    expect(countBeadsTasksDetailed(tmpDir, 'PAN-1094')).toMatchObject({
      count: 0,
      source: 'jsonl-fallback',
      transientFailure: expect.anything(),
    });
  });

  it('keeps known jsonl beads when a live bd read has transient lock contention', async () => {
    childProcessMocks.execFileSync.mockImplementation(() => {
      throw { stderr: 'database is locked' };
    });
    mkdirSync(join(tmpDir, '.beads'), { recursive: true });
    writeFileSync(join(tmpDir, '.beads', 'issues.jsonl'), JSON.stringify({
      id: 'panopticon-2',
      title: 'PAN-1094: Task',
      labels: ['pan-1094'],
    }) + '\n');
    const { countBeadsTasksDetailed, hasBeadsTasks } = await import('../../../../src/cli/commands/start.js');

    expect(countBeadsTasksDetailed(tmpDir, 'PAN-1094')).toMatchObject({
      count: 1,
      source: 'jsonl-fallback',
      transientFailure: expect.anything(),
    });
    expect(hasBeadsTasks(tmpDir, 'PAN-1094')).toBe(true);
  });

  it('retries the live start gate query before falling back to jsonl', async () => {
    vi.useFakeTimers();
    childProcessMocks.execFile.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(new Error('database is locked'), '', 'database is locked');
    });
    childProcessMocks.execFile.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: Function) => {
      callback(null, { stdout: JSON.stringify([{ id: 'panopticon-4' }]) }, '');
    });
    const { countBeadsTasksDetailedWithRetry } = await import('../../../../src/cli/commands/start.js');

    await expect(countBeadsTasksDetailedWithRetry(tmpDir, 'PAN-1094', {
      maxAttempts: 2,
      initialDelayMs: 100,
      maxDelayMs: 100,
      random: () => 0,
      sleep: (ms) => vi.advanceTimersByTimeAsync(ms),
    })).resolves.toMatchObject({ count: 1, source: 'bd' });
    expect(childProcessMocks.execFile).toHaveBeenCalledTimes(2);
  });

  it('regression: five concurrent start gate reads all recover from transient lock contention', async () => {
    vi.useFakeTimers();
    let calls = 0;
    childProcessMocks.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: Function) => {
      calls += 1;
      if (calls % 2 === 1) {
        callback(new Error('database is locked'), '', 'database is locked');
        return;
      }
      callback(null, { stdout: JSON.stringify([{ id: `panopticon-${calls}` }]) }, '');
    });
    const { countBeadsTasksDetailedWithRetry } = await import('../../../../src/cli/commands/start.js');

    const results = await Promise.all(Array.from({ length: 5 }, () => countBeadsTasksDetailedWithRetry(tmpDir, 'PAN-1094', {
      maxAttempts: 5,
      initialDelayMs: 100,
      maxDelayMs: 100,
      random: () => 0,
      sleep: (ms) => vi.advanceTimersByTimeAsync(ms),
    })));

    expect(results).toHaveLength(5);
    expect(results.every(result => result.count === 1 && result.source === 'bd' && result.transientFailure === undefined)).toBe(true);
    expect(childProcessMocks.execFile.mock.calls.length).toBeGreaterThanOrEqual(10);
  });

  it('detects when beads do not cover every vBRIEF item', async () => {
    const { validateBeadsMatchPlan } = await import('../../../../src/cli/commands/start.js');
    const workspace = join(tmpDir, 'workspaces', 'feature-pan-1094');
    mkdirSync(join(workspace, '.pan'), { recursive: true });
    mkdirSync(join(workspace, '.beads'), { recursive: true });
    writeFileSync(join(workspace, '.pan', 'spec.vbrief.json'), JSON.stringify({
      vBRIEFInfo: { version: '0.5', created: '2026-05-16T00:00:00Z' },
      plan: {
        id: 'PAN-1094',
        title: 'Test plan',
        status: 'proposed',
        items: [
          { id: 'one', title: 'One', status: 'pending' },
          { id: 'two', title: 'Two', status: 'pending' },
        ],
        edges: [],
      },
    }));
    writeFileSync(join(workspace, '.beads', 'issues.jsonl'), JSON.stringify({
      id: 'panopticon-2',
      title: 'PAN-1094: One',
      labels: ['pan-1094'],
    }) + '\n');

    expect(validateBeadsMatchPlan(workspace, 'PAN-1094')).toEqual({
      valid: false,
      beadCount: 1,
      planItemCount: 2,
    });
  });
});
