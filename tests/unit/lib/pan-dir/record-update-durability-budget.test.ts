/**
 * PAN-2989: the under-lock durability wait in `updateIssueRecord` is bounded by
 * OVERDECK_RECORD_DURABILITY_BUDGET_MS (default 30s). A stalled state push must
 * release the per-issue record lock instead of starving peer writers for minutes,
 * and the timeout path must never restore the pre-mutation snapshot (the
 * background flush may still land the commit).
 *
 * PAN-3848 (W23): the lock now covers only the read-mutate-write-commit; the
 * push runs after the locks are released (`commitAutoCommits` inside,
 * `pushAutoCommits` outside), keyed per issue so one issue's slow push never
 * blocks another issue's commit.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import type { FlushResult, PushResult } from '../../../../src/lib/pan-dir/auto-commit.js';

const ISSUE_ID = 'DURABLE-1';
const OTHER_ISSUE_ID = 'DURABLE-2';

const mockCommitAutoCommits = vi.hoisted(() => vi.fn());
const mockPushAutoCommits = vi.hoisted(() => vi.fn());
const mockQueueAutoCommit = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/pan-dir/auto-commit.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/pan-dir/auto-commit.js')>(
    '../../../../src/lib/pan-dir/auto-commit.js',
  );
  return {
    ...actual,
    commitAutoCommits: mockCommitAutoCommits,
    pushAutoCommits: mockPushAutoCommits,
    // Stub the debounced queue so no real background git work is scheduled under
    // fake timers; the tests drive commitAutoCommits/pushAutoCommits explicitly.
    queueAutoCommit: mockQueueAutoCommit,
  };
});

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function healthyCommit(): Effect.Effect<FlushResult> {
  return Effect.succeed({ committed: true, pushDeferred: true } satisfies FlushResult);
}

function healthyPush(): Effect.Effect<PushResult> {
  return Effect.succeed({ pushed: true } satisfies PushResult);
}

function hangingCommit(): Effect.Effect<FlushResult> {
  return Effect.promise(() => new Promise<FlushResult>(() => undefined));
}

function hangingPush(): Effect.Effect<PushResult> {
  return Effect.promise(() => new Promise<PushResult>(() => undefined));
}

function readLocalRecord(root: string, issueId = ISSUE_ID): PanIssueRecord {
  return JSON.parse(
    readFileSync(join(root, '.pan', 'records', `${issueId.toLowerCase()}.json`), 'utf8'),
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

function seedRecord(root: string, issueId: string): PanIssueRecord {
  return {
    issueId,
    schemaVersion: 2,
    statusOverrides: {},
    pipeline: { issueId, reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: new Date().toISOString() },
    closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'main' },
  } as PanIssueRecord;
}

describe('updateIssueRecord durability budget (PAN-2989)', () => {
  let root: string;
  let remote: string;
  let project: ProjectConfig;
  const originalHome = process.env.OVERDECK_HOME;
  const originalBudget = process.env.OVERDECK_RECORD_DURABILITY_BUDGET_MS;

  beforeEach(() => {
    // Keep the ref-lock push retry (auto-commit.ts) instant: these tests hold the race open on purpose.
    process.env.OVERDECK_STATE_PUSH_RETRY_DELAYS_MS = '0,0,0';
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

    mkdirSync(join(root, '.pan', 'records'), { recursive: true });
    writeFileSync(join(root, '.pan', 'records', 'durable-1.json'), JSON.stringify(seedRecord(root, ISSUE_ID)));
    writeFileSync(join(root, '.pan', 'records', 'durable-2.json'), JSON.stringify(seedRecord(root, OTHER_ISSUE_ID)));
    git(root, 'add', '.pan/records');
    git(root, 'commit', '-q', '-m', 'seed state');
    git(root, 'branch', '-M', 'main');
    git(root, 'push', '-q', '-u', 'origin', 'main');

    mockCommitAutoCommits.mockReset();
    mockPushAutoCommits.mockReset();
    mockQueueAutoCommit.mockReset();
    mockCommitAutoCommits.mockImplementation(() => healthyCommit());
    mockPushAutoCommits.mockImplementation(() => healthyPush());
    vi.useFakeTimers();
  });

  afterEach(() => {
    delete process.env.OVERDECK_STATE_PUSH_RETRY_DELAYS_MS;
    vi.useRealTimers();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    if (originalBudget === undefined) delete process.env.OVERDECK_RECORD_DURABILITY_BUDGET_MS;
    else process.env.OVERDECK_RECORD_DURABILITY_BUDGET_MS = originalBudget;
    rmSync(root, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });

  it('rejects with RecordDurabilityTimeoutError after the 30s default and releases the lock', async () => {
    mockCommitAutoCommits.mockImplementation(() => hangingCommit());

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
    mockCommitAutoCommits.mockImplementation(() => healthyCommit());
    mockPushAutoCommits.mockImplementation(() => healthyPush());
    const second = await updateIssueRecord(project, ISSUE_ID, (record) => {
      record.statusOverrides = { ...(record.statusOverrides ?? {}), 'wi-2': 'completed' };
    });
    expect(second.statusOverrides).toEqual({ 'wi-1': 'completed', 'wi-2': 'completed' });
  });

  it('keeps the mutation in the local record and never aborts the commit on timeout', async () => {
    let commitAbortSignalled = false;
    mockCommitAutoCommits.mockImplementation((_root: string, signal?: AbortSignal) => {
      signal?.addEventListener('abort', () => {
        commitAbortSignalled = true;
      });
      return hangingCommit();
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
    // The commit was raced, not aborted — no AbortSignal may reach it (NFR-1: a
    // timing-out writer must not cancel peers' shared-gitRoot flushes).
    expect(commitAbortSignalled).toBe(false);
    expect(mockCommitAutoCommits).toHaveBeenCalledTimes(1);
    // The commit never finished, so no post-lock push was attempted.
    expect(mockPushAutoCommits).not.toHaveBeenCalled();
  });

  it('honors OVERDECK_RECORD_DURABILITY_BUDGET_MS over the 30s default', async () => {
    process.env.OVERDECK_RECORD_DURABILITY_BUDGET_MS = '5000';
    mockCommitAutoCommits.mockImplementation(() => hangingCommit());

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

  it('returns the updated record unchanged when the commit and push resolve within budget', async () => {
    const result = await updateIssueRecord(project, ISSUE_ID, (record) => {
      record.statusOverrides = { 'wi-1': 'completed' };
    });

    expect(result.statusOverrides).toEqual({ 'wi-1': 'completed' });
    expect(mockCommitAutoCommits).toHaveBeenCalledTimes(1);
    expect(mockPushAutoCommits).toHaveBeenCalledTimes(1);
  });

  it('aborts a hung restore at the deadline so it never rewinds the record after lock release', async () => {
    // A commit-phase failure routes the error path into restoreRetryableRecord
    // (the push phase no longer runs under the lock, PAN-3848 W23).
    mockCommitAutoCommits.mockImplementation(() =>
      Effect.succeed({ committed: false, errored: true, reason: 'simulated commit failure' } satisfies FlushResult),
    );
    // Hang the restore's fetch: the remote's upload-pack sleeps before serving.
    const hook = join(remote, 'hooks', 'pre-upload-pack');
    writeFileSync(hook, '#!/bin/sh\nsleep 60\n');
    chmodSync(hook, 0o755);

    const first = updateIssueRecord(project, ISSUE_ID, (record) => {
      record.statusOverrides = { 'wi-1': 'completed' };
    });
    const rejection = expect(first).rejects.toBeInstanceOf(RecordDurabilityTimeoutError);
    await settleUntilDeadlineArmed();
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;

    // The restore's git subprocess was killed at the deadline, before its
    // pre-mutation snapshot write: the mutation survives on disk.
    expect(readLocalRecord(root).statusOverrides).toEqual({ 'wi-1': 'completed' });
    expect(git(root, 'log', '--format=%s', '-3')).not.toContain('restore');
    // A commit failure never reaches the post-lock push.
    expect(mockPushAutoCommits).not.toHaveBeenCalled();

    // The lock is free — a second writer completes immediately...
    mockCommitAutoCommits.mockImplementation(() => healthyCommit());
    mockPushAutoCommits.mockImplementation(() => healthyPush());
    await updateIssueRecord(project, ISSUE_ID, (record) => {
      record.statusOverrides = { ...(record.statusOverrides ?? {}), 'wi-2': 'completed' };
    });
    // ...and still nothing from the timed-out restore lands afterwards.
    expect(readLocalRecord(root).statusOverrides).toEqual({ 'wi-1': 'completed', 'wi-2': 'completed' });
    expect(git(root, 'log', '--format=%s', '-3')).not.toContain('restore');
  });

  it('aborts a hung reconcile fetch at the deadline — no rebase or push after the caller fails', async () => {
    // Migrated layout: a state worktree on overdeck-state with the marker.
    const stateRoot = join(process.env.OVERDECK_HOME!, 'state', 'migrated');
    mkdirSync(join(stateRoot, 'records'), { recursive: true });
    git(stateRoot, 'init', '-q');
    git(stateRoot, 'config', 'user.email', 'test@overdeck.local');
    git(stateRoot, 'config', 'user.name', 'Overdeck Test');
    git(stateRoot, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(stateRoot, 'migration-complete.json'), JSON.stringify({
      sourceMainSha: '0'.repeat(40),
      stateBranchSha: '0'.repeat(40),
      completedAt: '2026-07-17T00:00:00.000Z',
      version: 1,
    }));
    writeFileSync(join(stateRoot, 'records', 'durable-1.json'), JSON.stringify(seedRecord(stateRoot, ISSUE_ID), null, 2));
    git(stateRoot, 'add', '.');
    git(stateRoot, 'commit', '-q', '-m', 'seed state branch');
    git(stateRoot, 'branch', '-M', 'overdeck-state');
    git(stateRoot, 'remote', 'add', 'origin', remote);
    git(stateRoot, 'push', '-q', '-u', 'origin', 'overdeck-state');
    const seedSha = git(stateRoot, 'rev-parse', 'HEAD');

    // Hang every fetch: the reconcile's first step never completes.
    const hook = join(remote, 'hooks', 'pre-upload-pack');
    writeFileSync(hook, '#!/bin/sh\nsleep 60\n');
    chmodSync(hook, 0o755);

    // A remote-ref race push failure routes into reconcileStatePush — now after
    // the locks are released (PAN-3848 W23).
    mockPushAutoCommits.mockImplementation(() =>
      Effect.succeed({
        pushed: false,
        reason: `error: cannot lock ref 'refs/heads/overdeck-state': is at ${'a'.repeat(40)} but expected ${'b'.repeat(40)}`,
      } satisfies PushResult),
    );

    const migratedProject = { ...project, path: stateRoot };
    const first = updateIssueRecord(migratedProject, ISSUE_ID, (record) => {
      record.statusOverrides = { 'wi-1': 'completed' };
    });
    const rejection = expect(first).rejects.toBeInstanceOf(RecordDurabilityTimeoutError);
    await settleUntilDeadlineArmed();
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;

    // The fetch was killed mid-flight: no rebase ran and no push landed.
    expect(git(stateRoot, 'rev-parse', 'HEAD')).toBe(seedSha);
    expect(git(remote, 'rev-parse', 'overdeck-state')).toBe(seedSha);
    expect(existsSync(join(stateRoot, '.git', 'rebase-merge'))).toBe(false);
    expect(existsSync(join(stateRoot, '.git', 'REBASE_HEAD'))).toBe(false);

    // A second writer acquires the lock immediately...
    mockPushAutoCommits.mockImplementation(() => healthyPush());
    const second = await updateIssueRecord(migratedProject, ISSUE_ID, (record) => {
      record.statusOverrides = { ...(record.statusOverrides ?? {}), 'wi-2': 'completed' };
    });
    expect(second.statusOverrides).toEqual({ 'wi-1': 'completed', 'wi-2': 'completed' });

    // ...and still nothing from the timed-out reconcile lands afterwards.
    expect(git(stateRoot, 'rev-parse', 'HEAD')).toBe(seedSha);
    expect(git(remote, 'rev-parse', 'overdeck-state')).toBe(seedSha);
    expect(existsSync(join(stateRoot, '.git', 'rebase-merge'))).toBe(false);
  });
});

describe('updateIssueRecord per-issue lock scope (PAN-3848 W23)', () => {
  let root: string;
  let remote: string;
  let project: ProjectConfig;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    process.env.OVERDECK_STATE_PUSH_RETRY_DELAYS_MS = '0,0,0';
    root = mkdtempSync(join(tmpdir(), 'pan-record-scope-'));
    remote = mkdtempSync(join(tmpdir(), 'pan-record-scope-origin-'));
    process.env.OVERDECK_HOME = join(root, 'overdeck-home');
    project = { name: 'Durability', path: root };

    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'test@overdeck.local');
    git(root, 'config', 'user.name', 'Overdeck Test');
    git(root, 'config', 'commit.gpgsign', 'false');
    git(remote, 'init', '--bare', '-q');
    git(root, 'remote', 'add', 'origin', remote);

    mkdirSync(join(root, '.pan', 'records'), { recursive: true });
    writeFileSync(join(root, '.pan', 'records', 'durable-1.json'), JSON.stringify(seedRecord(root, ISSUE_ID)));
    writeFileSync(join(root, '.pan', 'records', 'durable-2.json'), JSON.stringify(seedRecord(root, OTHER_ISSUE_ID)));
    git(root, 'add', '.pan/records');
    git(root, 'commit', '-q', '-m', 'seed state');
    git(root, 'branch', '-M', 'main');
    git(root, 'push', '-q', '-u', 'origin', 'main');

    mockCommitAutoCommits.mockReset();
    mockPushAutoCommits.mockReset();
    mockQueueAutoCommit.mockReset();
    mockCommitAutoCommits.mockImplementation(() => healthyCommit());
    mockPushAutoCommits.mockImplementation(() => healthyPush());
    // Real timers in this describe: the lock retry ladder and the deferred
    // post-lock push must behave as in production, and nothing here hangs on
    // a timer that fake timers would need to advance.
  });

  afterEach(() => {
    delete process.env.OVERDECK_STATE_PUSH_RETRY_DELAYS_MS;
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });

  it('a record commit for issue A completes while issue B’s push is still in flight', async () => {
    // B's post-lock push hangs; A must not wait on it (the pre-W23
    // project-wide lock was held across the push and would have blocked A's
    // commit with a RecordLockError after the retry ladder).
    let releaseB!: () => void;
    mockPushAutoCommits.mockImplementationOnce(() =>
      Effect.promise(() => new Promise<PushResult>((resolve) => {
        releaseB = () => resolve({ pushed: true });
      })),
    );

    const b = updateIssueRecord(project, OTHER_ISSUE_ID, (record) => {
      record.statusOverrides = { 'b-1': 'completed' };
    });
    // Let B finish its commit and enter its hanging post-lock push. Real
    // `setImmediate` turns — no fake timers here, so the fs-lock retry ladder
    // and the deferred push behave as in production.
    for (let turn = 0; turn < 10_000 && mockPushAutoCommits.mock.calls.length < 1; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(mockPushAutoCommits).toHaveBeenCalledTimes(1);

    const a = await updateIssueRecord(project, ISSUE_ID, (record) => {
      record.statusOverrides = { 'a-1': 'completed' };
    });
    expect(a.statusOverrides).toEqual({ 'a-1': 'completed' });
    expect(mockCommitAutoCommits).toHaveBeenCalledTimes(2);
    expect(mockPushAutoCommits).toHaveBeenCalledTimes(2);

    releaseB();
    await expect(b).resolves.toMatchObject({ statusOverrides: { 'b-1': 'completed' } });
  });

  it('two updates on the same issue serialize their locked sections', async () => {
    // Gate the first writer's commit: it holds the per-issue fs lock from the
    // mutation through the commit, so the second writer's mutator must not run
    // until the first's commit resolves — and then it must observe wi-1.
    let releaseFirstCommit!: () => void;
    mockCommitAutoCommits.mockImplementationOnce(() =>
      Effect.promise(() => new Promise<FlushResult>((resolve) => {
        releaseFirstCommit = () => resolve({ committed: true, pushDeferred: true });
      })),
    );

    let firstMutated = false;
    const first = updateIssueRecord(project, ISSUE_ID, (record) => {
      firstMutated = true;
      record.statusOverrides = { 'wi-1': 'completed' };
    });
    for (let turn = 0; turn < 10_000 && mockCommitAutoCommits.mock.calls.length < 1; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(firstMutated).toBe(true);

    let secondMutatorRan = false;
    const second = updateIssueRecord(project, ISSUE_ID, (record) => {
      secondMutatorRan = true;
      expect(record.statusOverrides).toEqual({ 'wi-1': 'completed' });
      record.statusOverrides = { ...(record.statusOverrides ?? {}), 'wi-2': 'completed' };
    });
    for (let turn = 0; turn < 20; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(secondMutatorRan).toBe(false);

    releaseFirstCommit();
    const [firstRecord, secondRecord] = await Promise.all([first, second]);
    expect(firstRecord.statusOverrides).toEqual({ 'wi-1': 'completed' });
    expect(secondRecord.statusOverrides).toEqual({ 'wi-1': 'completed', 'wi-2': 'completed' });
    expect(readLocalRecord(root).statusOverrides).toEqual({ 'wi-1': 'completed', 'wi-2': 'completed' });
  });

  it('the record lock error text names the issue the lock belongs to', async () => {
    // Hold issue A's fs lock from a foreign pid so updateIssueRecord's retry
    // ladder exhausts instantly.
    const { acquireRecordLock } = await import('../../../../src/lib/pan-dir/fs-lock.js');
    const { recordLockPath } = await import('../../../../src/lib/pan-dir/fs-lock.js');
    const lockPath = recordLockPath(project, ISSUE_ID);
    await acquireRecordLock(lockPath, {
      writerId: 'foreign-writer',
      recordPath: join(root, '.pan', 'records', 'durable-1.json'),
      issueId: ISSUE_ID,
      retryDelaysMs: [],
    });

    await expect(updateIssueRecord(project, ISSUE_ID, () => undefined)).rejects.toThrow(
      `The record lock for ${ISSUE_ID} at ${lockPath} is held by foreign-writer`,
    );
  });
});
