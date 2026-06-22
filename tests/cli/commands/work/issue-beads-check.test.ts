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
  process.env.OVERDECK_HOME = join(tmpDir, '.overdeck-home');
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
      id: 'overdeck-1',
      title: 'PAN-1093: Task',
      labels: ['pan-1093'],
    }) + '\n');

    expect(hasBeadsTasks(tmpDir, 'PAN-1094')).toBe(false);
  });

  it('returns true when issues.jsonl contains a bead labeled for the issue', async () => {
    const { hasBeadsTasks } = await import('../../../../src/cli/commands/start.js');
    mkdirSync(join(tmpDir, '.beads'), { recursive: true });
    writeFileSync(join(tmpDir, '.beads', 'issues.jsonl'), JSON.stringify({
      id: 'overdeck-2',
      title: 'PAN-1094: Task',
      labels: ['pan-1094'],
    }) + '\n');

    expect(hasBeadsTasks(tmpDir, 'PAN-1094')).toBe(true);
  });

  it('returns true when bd reports a matching issue bead', async () => {
    childProcessMocks.execFileSync.mockImplementation(() => JSON.stringify([{ id: 'overdeck-3' }]));
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
      id: 'overdeck-2',
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
      callback(null, { stdout: JSON.stringify([{ id: 'overdeck-4' }]) }, '');
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

  // SKIPPED — structurally flaky under CI parallel-worker load; red-gated the
  // v0.30.0 release (run 27969902569, the sole failure: 1/7189). Passes
  // reliably in isolation locally but intermittently fails in CI.
  //
  // Root cause: the mock decides pass/fail from the PARITY of a single shared
  // monotonic `calls` counter (odd → 'database is locked', even → success),
  // while the 5 concurrent retry loops drive that counter through
  // fake-timer-driven interleaving AND runBdWithRetry wraps each call in a REAL
  // cross-process file lock (withBdProcessLock, real fs.open/process.kill). So
  // whether a given caller's Nth attempt lands on an even or odd global call
  // number depends on lock-acquisition + microtask ordering under load — one
  // caller can draw 5 odd-parity calls and exhaust maxAttempts, falling back to
  // jsonl (count 0) and failing the `source === 'bd'` assertion. A shared
  // parity mock cannot guarantee every concurrent caller recovers within a
  // bounded per-caller budget.
  //
  // The retry-recovery path this guards is still covered DETERMINISTICALLY by
  // the sibling test above ('retries the live start gate query before falling
  // back to jsonl'). The only coverage lost here is the concurrent aspect, which
  // a shared mock cannot assert reliably — a proper rewrite needs per-caller
  // failure injection (unique caller id threaded through runBdWithRetry, or a
  // deterministic fake lock with no real fs/process.kill). See follow-up.
  it.skip('regression: five concurrent start gate reads all recover from transient lock contention', async () => {
    vi.useFakeTimers();
    let calls = 0;
    childProcessMocks.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: Function) => {
      calls += 1;
      if (calls % 2 === 1) {
        callback(new Error('database is locked'), '', 'database is locked');
        return;
      }
      callback(null, { stdout: JSON.stringify([{ id: `overdeck-${calls}` }]) }, '');
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
      id: 'overdeck-2',
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
