/**
 * PAN-2989: the under-lock durability wait in `updateIssueRecord` is bounded by
 * OVERDECK_RECORD_DURABILITY_BUDGET_MS (default 30s). A stalled state push must
 * release the per-issue record lock instead of starving peer writers for minutes,
 * and the timeout path must never restore the pre-mutation snapshot (the
 * background flush may still land the commit).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectConfig } from '../../../../src/lib/projects.js';
import type { PanIssueRecord } from '../../../../src/lib/pan-dir/record.js';
import {
  RecordDurabilityTimeoutError,
  updateIssueRecord,
} from '../../../../src/lib/pan-dir/record-update.js';
import type { FlushResult } from '../../../../src/lib/pan-dir/auto-commit.js';

const ISSUE_ID = 'DURABLE-1';

const mockFlushAutoCommits = vi.hoisted(() => vi.fn());
const mockQueueAutoCommit = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/pan-dir/auto-commit.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/pan-dir/auto-commit.js')>(
    '../../../../src/lib/pan-dir/auto-commit.js',
  );
  return {
    ...actual,
    flushAutoCommits: mockFlushAutoCommits,
    // Stub the debounced queue so no real background git work is scheduled under
    // fake timers; the tests drive flushAutoCommits explicitly.
    queueAutoCommit: mockQueueAutoCommit,
  };
});

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function healthyFlush(): Effect.Effect<FlushResult> {
  return Effect.succeed({ committed: true, pushed: true } satisfies FlushResult);
}

function hangingFlush(): Effect.Effect<FlushResult> {
  return Effect.promise(() => new Promise<FlushResult>(() => undefined));
}

function readLocalRecord(root: string): PanIssueRecord {
  return JSON.parse(
    readFileSync(join(root, '.pan', 'records', 'durable-1.json'), 'utf8'),
  ) as PanIssueRecord;
}

/**
 * Yield to the real event loop until the durability deadline timer is
 * registered inside `updateIssueRecord`. `setImmediate` here is the
 * `node:timers` import, which fake timers do not replace; waiting on
 * `vi.getTimerCount()` is the same pattern `fs-lock.test.ts` uses for the
 * lock retry ladder.
 */
async function settleUntilDeadlineArmed(): Promise<void> {
  while (vi.getTimerCount() === 0) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('updateIssueRecord durability budget (PAN-2989)', () => {
  let root: string;
  let remote: string;
  let project: ProjectConfig;
  const originalHome = process.env.OVERDECK_HOME;
  const originalBudget = process.env.OVERDECK_RECORD_DURABILITY_BUDGET_MS;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-record-budget-'));
    remote = mkdtempSync(join(tmpdir(), 'pan-record-budget-origin-'));
    process.env.OVERDECK_HOME = join(root, 'overdeck-home');
    delete process.env.OVERDECK_RECORD_DURABILITY_BUDGET_MS;
    project = { name: 'Durability', path: root };

    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'test@overdeck.local');
    git(root, 'config', 'user.name', 'Overdeck Test');
    git(root, 'config', 'commit.gpgsign', 'false');
    git(remote, 'init', '--bare', '-q');
    git(root, 'remote', 'add', 'origin', remote);

    const record = {
      issueId: ISSUE_ID,
      schemaVersion: 2,
      statusOverrides: {},
      pipeline: { issueId: ISSUE_ID, reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: new Date().toISOString() },
      closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'main' },
    } as PanIssueRecord;
    mkdirSync(join(root, '.pan', 'records'), { recursive: true });
    writeFileSync(join(root, '.pan', 'records', 'durable-1.json'), JSON.stringify(record));
    git(root, 'add', '.pan/records');
    git(root, 'commit', '-q', '-m', 'seed state');
    git(root, 'branch', '-M', 'main');
    git(root, 'push', '-q', '-u', 'origin', 'main');

    mockFlushAutoCommits.mockReset();
    mockQueueAutoCommit.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    if (originalBudget === undefined) delete process.env.OVERDECK_RECORD_DURABILITY_BUDGET_MS;
    else process.env.OVERDECK_RECORD_DURABILITY_BUDGET_MS = originalBudget;
    rmSync(root, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });

  it('rejects with RecordDurabilityTimeoutError after the 30s default and releases the lock', async () => {
    mockFlushAutoCommits.mockImplementation(() => hangingFlush());

    let settled = false;
    const first = updateIssueRecord(project, ISSUE_ID, (record) => {
      record.statusOverrides = { 'wi-1': 'completed' };
    });
    const rejection = expect(first).rejects.toBeInstanceOf(RecordDurabilityTimeoutError);
    void first.catch(() => {
      settled = true;
    });

    await settleUntilDeadlineArmed();
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(settled).toBe(true);

    // The lock is immediately acquirable by a second writer.
    mockFlushAutoCommits.mockImplementation(() => healthyFlush());
    const second = await updateIssueRecord(project, ISSUE_ID, (record) => {
      record.statusOverrides = { ...(record.statusOverrides ?? {}), 'wi-2': 'completed' };
    });
    expect(second.statusOverrides).toEqual({ 'wi-1': 'completed', 'wi-2': 'completed' });
  });

  it('keeps the mutation in the local record and never aborts the flush on timeout', async () => {
    let flushAbortSignalled = false;
    mockFlushAutoCommits.mockImplementation((_root: string, signal?: AbortSignal) => {
      signal?.addEventListener('abort', () => {
        flushAbortSignalled = true;
      });
      return hangingFlush();
    });

    const first = updateIssueRecord(project, ISSUE_ID, (record) => {
      record.statusOverrides = { 'wi-1': 'completed' };
    });
    const rejection = expect(first).rejects.toBeInstanceOf(RecordDurabilityTimeoutError);
    await settleUntilDeadlineArmed();
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;

    // restoreRetryableRecord must NOT have rewound the file to the pre-mutation
    // snapshot — the background flush may still land this commit.
    expect(readLocalRecord(root).statusOverrides).toEqual({ 'wi-1': 'completed' });
    // The flush was raced, not aborted — no AbortSignal may reach it (NFR-1: a
    // timing-out writer must not cancel peers' shared-gitRoot flushes).
    expect(flushAbortSignalled).toBe(false);
    expect(mockFlushAutoCommits).toHaveBeenCalledTimes(1);
  });

  it('honors OVERDECK_RECORD_DURABILITY_BUDGET_MS over the 30s default', async () => {
    process.env.OVERDECK_RECORD_DURABILITY_BUDGET_MS = '5000';
    mockFlushAutoCommits.mockImplementation(() => hangingFlush());

    let settled = false;
    const first = updateIssueRecord(project, ISSUE_ID, (record) => {
      record.statusOverrides = { 'wi-1': 'completed' };
    });
    const rejection = expect(first).rejects.toBeInstanceOf(RecordDurabilityTimeoutError);
    void first.catch(() => {
      settled = true;
    });

    await settleUntilDeadlineArmed();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(settled).toBe(true);
  });

  it('returns the updated record unchanged when the flush resolves within budget', async () => {
    mockFlushAutoCommits.mockImplementation(() => healthyFlush());

    const result = await updateIssueRecord(project, ISSUE_ID, (record) => {
      record.statusOverrides = { 'wi-1': 'completed' };
    });

    expect(result.statusOverrides).toEqual({ 'wi-1': 'completed' });
    expect(mockFlushAutoCommits).toHaveBeenCalledTimes(1);
  });
});
