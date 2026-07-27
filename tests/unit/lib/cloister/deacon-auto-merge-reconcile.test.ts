import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForgeAdapter } from '../../../../src/lib/forge.js';
import {
  cancelPending,
  listActiveAutoMerges,
  listProblemAutoMerges,
  markMerged,
  type PendingAutoMergeStatus,
} from '../../../../src/lib/overdeck/merge-sync.js';
import {
  reconcileAutoMergeRowsWithDeps,
  type AutoMergeReconcileDeps,
} from '../../../../src/lib/cloister/deacon-auto-merge-reconcile.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';

const NOW = Date.parse('2026-07-27T00:00:00.000Z');
let odb: OverdeckTestDb;

beforeEach(() => { odb = setupOverdeckTestDb(); });
afterEach(() => { teardownOverdeckTestDb(odb); });

function seedIssue(issueId: string): void {
  odb.raw().prepare(
    "INSERT INTO issues (id, stage, updated_at) VALUES (?, 'open', ?)",
  ).run(issueId, NOW);
}

function seedAutoMerge(issueId: string, status: PendingAutoMergeStatus): number {
  const result = odb.raw().prepare(`
    INSERT INTO pending_auto_merges
      (issue_id, pr_url, project_key, forge, status, scheduled_merge_at, scheduled_at)
    VALUES (?, ?, 'overdeck', 'github', ?, ?, ?)
  `).run(
    issueId,
    `https://github.com/eltmon/overdeck/pull/${issueId.slice(4)}`,
    status,
    NOW,
    NOW,
  );
  return Number(result.lastInsertRowid);
}

function row(id: number): { status: string; cancelled_by: string | null; merged_at: number | null } {
  return odb.raw().prepare(
    'SELECT status, cancelled_by, merged_at FROM pending_auto_merges WHERE id = ?',
  ).get(id) as { status: string; cancelled_by: string | null; merged_at: number | null };
}

function forgeAdapter(findMergedArtifact: ForgeAdapter['findMergedArtifact']): ForgeAdapter {
  return { findMergedArtifact } as ForgeAdapter;
}

function makeDeps(overrides: Partial<AutoMergeReconcileDeps> = {}): AutoMergeReconcileDeps {
  return {
    now: vi.fn(() => NOW),
    listProblemAutoMerges,
    listActiveAutoMerges,
    cancelPending,
    markMerged,
    readJournalStatus: vi.fn(() => null),
    resolveProject: vi.fn(() => ({
      projectKey: 'overdeck',
      projectName: 'Overdeck',
      projectPath: '/tmp/overdeck',
    })),
    getForgeAdapter: vi.fn(() => forgeAdapter(vi.fn(async () => null))),
    log: vi.fn(),
    warn: vi.fn(),
    ...overrides,
  };
}

function mergedArtifact() {
  return {
    forge: 'github' as const,
    created: false,
    url: 'https://github.com/eltmon/overdeck/pull/1',
    id: '1',
  };
}

describe('reconcileAutoMergeRowsWithDeps', () => {
  it('marks a failed row merged when the forge confirms its PR merged', async () => {
    seedIssue('PAN-101');
    const id = seedAutoMerge('PAN-101', 'failed');
    const findMergedArtifact = vi.fn(async () => mergedArtifact());
    const deps = makeDeps({
      getForgeAdapter: vi.fn(() => forgeAdapter(findMergedArtifact)),
    });

    await reconcileAutoMergeRowsWithDeps(deps);

    expect(findMergedArtifact).toHaveBeenCalledWith({
      sourceBranch: 'feature/pan-101',
      artifactUrl: 'https://github.com/eltmon/overdeck/pull/101',
      cwd: '/tmp/overdeck',
    });
    expect(row(id).status).toBe('merged');
    expect(row(id).merged_at).toBeGreaterThan(0);
    expect(listProblemAutoMerges()).toEqual([]);
  });

  it('cancels every failed and blocked row for a closed-out issue without querying the forge', async () => {
    seedIssue('PAN-102');
    const failedId = seedAutoMerge('PAN-102', 'failed');
    const blockedId = seedAutoMerge('PAN-102', 'blocked');
    const findMergedArtifact = vi.fn(async () => mergedArtifact());
    const deps = makeDeps({
      readJournalStatus: vi.fn(() => ({
        updatedAt: new Date(NOW).toISOString(),
        durable: { closedOut: true },
      })),
      getForgeAdapter: vi.fn(() => forgeAdapter(findMergedArtifact)),
    });

    await reconcileAutoMergeRowsWithDeps(deps);

    expect(row(failedId)).toMatchObject({ status: 'cancelled', cancelled_by: 'auto-merge-reconciler' });
    expect(row(blockedId)).toMatchObject({ status: 'cancelled', cancelled_by: 'auto-merge-reconciler' });
    expect(findMergedArtifact).not.toHaveBeenCalled();
  });

  it('cancels a pending row when its issue is closed out', async () => {
    seedIssue('PAN-103');
    const id = seedAutoMerge('PAN-103', 'pending');
    const deps = makeDeps({
      readJournalStatus: vi.fn(() => ({
        updatedAt: new Date(NOW).toISOString(),
        durable: { closedOut: true },
      })),
    });

    await reconcileAutoMergeRowsWithDeps(deps);

    expect(row(id)).toMatchObject({ status: 'cancelled', cancelled_by: 'auto-merge-reconciler' });
  });

  it('marks every duplicate failed row for one issue merged in a single run', async () => {
    seedIssue('PAN-104');
    const firstId = seedAutoMerge('PAN-104', 'failed');
    const secondId = seedAutoMerge('PAN-104', 'failed');
    const findMergedArtifact = vi.fn(async () => mergedArtifact());
    const deps = makeDeps({
      getForgeAdapter: vi.fn(() => forgeAdapter(findMergedArtifact)),
    });

    await reconcileAutoMergeRowsWithDeps(deps);

    expect(row(firstId).status).toBe('merged');
    expect(row(secondId).status).toBe('merged');
    expect(findMergedArtifact).toHaveBeenCalledTimes(1);
  });

  it('leaves an unmerged failed row actionable and suppresses an immediate forge re-check', async () => {
    seedIssue('PAN-105');
    const id = seedAutoMerge('PAN-105', 'failed');
    const findMergedArtifact = vi.fn(async () => null);
    const deps = makeDeps({
      getForgeAdapter: vi.fn(() => forgeAdapter(findMergedArtifact)),
    });

    await reconcileAutoMergeRowsWithDeps(deps);
    await reconcileAutoMergeRowsWithDeps(deps);

    expect(row(id).status).toBe('failed');
    expect(listProblemAutoMerges().map((entry) => entry.id)).toEqual([id]);
    expect(findMergedArtifact).toHaveBeenCalledTimes(1);
  });

  it('contains forge errors, preserves the row, and applies the cooldown', async () => {
    seedIssue('PAN-106');
    const id = seedAutoMerge('PAN-106', 'failed');
    const findMergedArtifact = vi.fn(async () => {
      throw new Error('forge unavailable');
    });
    const deps = makeDeps({
      getForgeAdapter: vi.fn(() => forgeAdapter(findMergedArtifact)),
    });

    await expect(reconcileAutoMergeRowsWithDeps(deps)).resolves.toEqual([]);
    await reconcileAutoMergeRowsWithDeps(deps);

    expect(row(id).status).toBe('failed');
    expect(findMergedArtifact).toHaveBeenCalledTimes(1);
    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining('forge unavailable'));
  });

  it('reconciles problem rows beyond the default 100-row route page', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `PAN-${2000 + index}`);
    for (const issueId of ids) {
      seedIssue(issueId);
      seedAutoMerge(issueId, 'failed');
    }
    const targetIssue = ids.at(-1)!;
    const findMergedArtifact = vi.fn(async (input: { artifactUrl?: string }) => (
      input.artifactUrl?.endsWith(`/${targetIssue.slice(4)}`) ? mergedArtifact() : null
    ));
    const deps = makeDeps({
      getForgeAdapter: vi.fn(() => forgeAdapter(findMergedArtifact)),
    });

    await reconcileAutoMergeRowsWithDeps(deps);

    expect(findMergedArtifact).toHaveBeenCalledTimes(101);
    expect(listProblemAutoMerges(200).find((entry) => entry.issueId === targetIssue)).toBeUndefined();
  });

  it('cancels closed-out pending rows beyond the default 100-row route page', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `PAN-${3000 + index}`);
    let targetId = 0;
    for (const issueId of ids) {
      seedIssue(issueId);
      targetId = seedAutoMerge(issueId, 'pending');
    }
    const deps = makeDeps({
      readJournalStatus: vi.fn(() => ({
        updatedAt: new Date(NOW).toISOString(),
        durable: { closedOut: true },
      })),
    });

    await reconcileAutoMergeRowsWithDeps(deps);

    expect(row(targetId)).toMatchObject({ status: 'cancelled', cancelled_by: 'auto-merge-reconciler' });
  });

  it('leaves merging rows untouched', async () => {
    seedIssue('PAN-107');
    const id = seedAutoMerge('PAN-107', 'merging');
    const findMergedArtifact = vi.fn(async () => mergedArtifact());
    const deps = makeDeps({
      getForgeAdapter: vi.fn(() => forgeAdapter(findMergedArtifact)),
    });

    await reconcileAutoMergeRowsWithDeps(deps);

    expect(row(id).status).toBe('merging');
    expect(findMergedArtifact).not.toHaveBeenCalled();
  });
});
