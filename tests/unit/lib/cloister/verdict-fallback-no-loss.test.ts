/**
 * PAN-3848 (W28) — no-loss audit for patrol #40 `sweepStrandedVerdictFallbacks`
 * and the workspace verdict fallback file (`pipeline-verdict.json`).
 *
 * Deletion gate evidence (the deletion itself is soak-gated and NOT in this
 * branch): the fallback exists for record-lock contention (F15 — the sweeper
 * drained eight self-inflicted fallbacks in one day while the project-wide
 * lock was held across pushes). W23 keyed the lock per issue and moved the
 * push after lock release, so a verdict write for issue A can no longer be
 * starved by issue B's slow push. This audit proves it against the REAL
 * record write door and the REAL fallback path, with only git I/O stubbed.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectConfig } from '../../../../src/lib/projects.js';
import type { PanIssueRecord } from '../../../../src/lib/pan-dir/record.js';
import type { FlushResult, PushResult } from '../../../../src/lib/pan-dir/auto-commit.js';

const mockGetCostBreakdown = vi.hoisted(() => vi.fn());
const mockGetCostForIssueSync = vi.hoisted(() => vi.fn());
const mockGetMergeSetSync = vi.hoisted(() => vi.fn());
const mockListOverdeckAgentStatesSync = vi.hoisted(() => vi.fn());
const mockGetProjectSync = vi.hoisted(() => vi.fn());
const mockResolveProjectFromIssueSync = vi.hoisted(() => vi.fn());
const mockCommitAutoCommits = vi.hoisted(() => vi.fn());
const mockPushAutoCommits = vi.hoisted(() => vi.fn());
const mockQueueAutoCommit = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/overdeck/cost-sync.js', () => ({
  getCostBreakdownByStageAndModelSync: mockGetCostBreakdown,
  getCostForIssueSync: mockGetCostForIssueSync,
}));
vi.mock('../../../../src/lib/merge-set.js', () => ({
  getMergeSetSync: mockGetMergeSetSync,
}));
vi.mock('../../../../src/lib/pan-dir/auto-commit.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/pan-dir/auto-commit.js')>(
    '../../../../src/lib/pan-dir/auto-commit.js',
  );
  return {
    ...actual,
    queueAutoCommit: mockQueueAutoCommit,
    commitAutoCommits: mockCommitAutoCommits,
    pushAutoCommits: mockPushAutoCommits,
  };
});
vi.mock('../../../../src/lib/overdeck/agent-state-sync.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/overdeck/agent-state-sync.js')>()),
  listOverdeckAgentStatesSync: mockListOverdeckAgentStatesSync,
}));
vi.mock('../../../../src/lib/projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/projects.js')>()),
  getProjectSync: mockGetProjectSync,
  resolveProjectFromIssueSync: mockResolveProjectFromIssueSync,
}));

import { updateIssueRecord } from '../../../../src/lib/pan-dir/record-update.js';
import {
  flushReviewStatusJournalWrites,
  updateIssueRecordForReviewStatusSync,
  workspaceVerdictFallbackPath,
} from '../../../../src/lib/overdeck/review-status-record-sync.js';
import { readIssueRecordSync } from '../../../../src/lib/pan-dir/record.js';
import type { ReviewStatus } from '../../../../src/lib/review-status-reconcile.js';

const ISSUE_A = 'FALLBACK-1';
const ISSUE_B = 'FALLBACK-2';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function seedRecord(issueId: string): PanIssueRecord {
  return {
    issueId,
    schemaVersion: 2,
    statusOverrides: {},
    pipeline: { issueId, reviewStatus: 'reviewing', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-09-17T00:00:00.000Z' },
    closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'main' },
  } as PanIssueRecord;
}

describe('verdict fallback no-loss audit (PAN-3848 W28)', () => {
  let root: string;
  let remote: string;
  let project: ProjectConfig;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-verdict-fallback-'));
    remote = mkdtempSync(join(tmpdir(), 'pan-verdict-fallback-origin-'));
    process.env.OVERDECK_HOME = join(root, 'overdeck-home');
    project = { name: 'Fallback', path: root };

    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'test@overdeck.local');
    git(root, 'config', 'user.name', 'Overdeck Test');
    git(root, 'config', 'commit.gpgsign', 'false');
    git(remote, 'init', '--bare', '-q');
    git(root, 'remote', 'add', 'origin', remote);
    mkdirSync(join(root, '.pan', 'records'), { recursive: true });
    writeFileSync(join(root, '.pan', 'records', `${ISSUE_A.toLowerCase()}.json`), JSON.stringify(seedRecord(ISSUE_A)));
    writeFileSync(join(root, '.pan', 'records', `${ISSUE_B.toLowerCase()}.json`), JSON.stringify(seedRecord(ISSUE_B)));
    git(root, 'add', '.pan/records');
    git(root, 'commit', '-q', '-m', 'seed state');
    git(root, 'branch', '-M', 'main');
    git(root, 'push', '-q', '-u', 'origin', 'main');

    mockGetCostBreakdown.mockReturnValue({ byStage: {}, totals: {} });
    mockGetCostForIssueSync.mockReturnValue(null);
    mockGetMergeSetSync.mockReturnValue(null);
    mockListOverdeckAgentStatesSync.mockReturnValue([]);
    mockGetProjectSync.mockReturnValue(project);
    mockResolveProjectFromIssueSync.mockReturnValue({ projectKey: 'fallback', projectPath: root });
    mockQueueAutoCommit.mockReset();
    mockCommitAutoCommits.mockReset().mockImplementation(() =>
      Effect.succeed({ committed: true, pushDeferred: true } satisfies FlushResult));
    mockPushAutoCommits.mockReset().mockImplementation(() =>
      Effect.succeed({ pushed: true } satisfies PushResult));
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });

  it('a verdict write for issue A lands in the journal while issue B holds the push open — no pipeline-verdict.json fallback', async () => {
    // B's post-lock push hangs (the F1 starvation shape: a slow network push
    // holding what used to be the project-wide lock).
    let releaseB!: () => void;
    mockPushAutoCommits.mockImplementationOnce(() =>
      Effect.promise(() => new Promise<PushResult>((resolve) => {
        releaseB = () => resolve({ pushed: true });
      })),
    );
    const b = updateIssueRecord(project, ISSUE_B, (record) => {
      record.statusOverrides = { 'b-1': 'completed' };
    });
    for (let turn = 0; turn < 10_000 && mockPushAutoCommits.mock.calls.length < 1; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(mockPushAutoCommits).toHaveBeenCalledTimes(1);

    // A's terminal verdict write goes through the real review-status write
    // path (verdictWrite: the PAN-3092 backoff tier).
    updateIssueRecordForReviewStatusSync(ISSUE_A, {
      issueId: ISSUE_A,
      reviewStatus: 'passed',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt: '2026-09-17T01:00:00.000Z',
    } as ReviewStatus, { verdictWrite: true });
    await flushReviewStatusJournalWrites();

    // The verdict landed in the per-issue journal — with W23's per-issue lock,
    // B's in-flight push never contended with A's write...
    const recordA = readIssueRecordSync(project, ISSUE_A);
    expect(recordA?.pipeline.reviewStatus).toBe('passed');

    // ...so the workspace fallback file the sweeper existed to drain was never
    // written, for either issue.
    const fallbackA = workspaceVerdictFallbackPath(ISSUE_A);
    const fallbackB = workspaceVerdictFallbackPath(ISSUE_B);
    expect(fallbackA).not.toBeNull();
    expect(existsSync(fallbackA!)).toBe(false);
    expect(fallbackB === null || !existsSync(fallbackB)).toBe(true);

    releaseB();
    await expect(b).resolves.toMatchObject({ statusOverrides: { 'b-1': 'completed' } });
  });
});
