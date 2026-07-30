import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOverdeckDatabaseSync, getOverdeckDatabaseSync } from '../infra.js';
import { requeueOrphanedMergingAutoMerges } from '../merge-sync.js';

/**
 * PAN-3328: a pending_auto_merges row stranded in 'merging' by a crash is
 * terminal to every surface — the problems endpoint reports only blocked/failed
 * and the deacon reconciler skips active rows that are not pending. Boot recovery
 * must hand those rows back to the executor.
 */
describe('requeueOrphanedMergingAutoMerges', () => {
  const originalOverdeckHome = process.env.OVERDECK_HOME;
  let testHome: string;

  beforeEach(() => {
    testHome = join(tmpdir(), `auto-merge-orphan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.OVERDECK_HOME = testHome;
    closeOverdeckDatabaseSync();
  });

  afterEach(() => {
    closeOverdeckDatabaseSync();
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }
    rmSync(testHome, { recursive: true, force: true });
  });

  function seed(issueId: string, status: string): void {
    getOverdeckDatabaseSync().prepare(
      'INSERT INTO issues (id, stage, updated_at) VALUES (?, ?, ?)',
    ).run(issueId, 'merging', Date.now());
    getOverdeckDatabaseSync().prepare(`
      INSERT INTO pending_auto_merges (issue_id, pr_url, project_key, forge, status, scheduled_merge_at, scheduled_at)
      VALUES (?, ?, 'pan', 'github', ?, ?, ?)
    `).run(issueId, `https://github.com/eltmon/overdeck/pull/1`, status, Date.now(), Date.now());
  }

  function statusOf(issueId: string): string {
    const row = getOverdeckDatabaseSync()
      .prepare('SELECT status FROM pending_auto_merges WHERE issue_id = ?')
      .get(issueId) as { status: string } | undefined;
    return row?.status ?? 'missing';
  }

  it('requeues merging rows to pending and leaves every other status alone', () => {
    seed('PAN-100', 'merging');
    seed('PAN-200', 'merged');
    seed('PAN-300', 'blocked');
    seed('PAN-400', 'pending');

    expect(requeueOrphanedMergingAutoMerges()).toBe(1);

    expect(statusOf('PAN-100')).toBe('pending');
    expect(statusOf('PAN-200')).toBe('merged');
    expect(statusOf('PAN-300')).toBe('blocked');
    expect(statusOf('PAN-400')).toBe('pending');
  });

  it('reports zero when no row is stranded', () => {
    seed('PAN-100', 'merged');
    expect(requeueOrphanedMergingAutoMerges()).toBe(0);
  });
});
