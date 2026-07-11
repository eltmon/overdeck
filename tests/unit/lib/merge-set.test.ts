/**
 * Tests for merge-set sync accessors (PAN-399 case-sensitivity follow-up).
 *
 * Verifies that getMergeSetSync normalizes lowercase issue IDs to the
 * canonical uppercase form stored in overdeck.db.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../helpers/overdeck-test-db.js';
import {
  getMergeSetSync,
  upsertMergeSetSync,
  deleteMergeSetSync,
} from '../../../src/lib/merge-set.js';
import type { MergeSet } from '../../../src/lib/merge-set.js';

let odb: OverdeckTestDb;

beforeEach(() => { odb = setupOverdeckTestDb(); });
afterEach(() => { teardownOverdeckTestDb(odb); });

function seedIssue(id: string): void {
  odb.raw().prepare(
    "INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, 'open', ?)",
  ).run(id, Date.now());
}

function makeMergeSet(overrides: Partial<MergeSet> = {}): MergeSet {
  return {
    issueId: 'PAN-399',
    projectKey: 'overdeck',
    projectPath: '/repo/overdeck',
    workspaceType: 'polyrepo',
    status: 'draft',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    repos: [],
    ...overrides,
  };
}

describe('merge-set sync accessors', () => {
  it('getMergeSetSync normalizes lowercase IDs to uppercase', () => {
    seedIssue('PAN-399');
    upsertMergeSetSync(makeMergeSet());

    const loaded = getMergeSetSync('pan-399');

    expect(loaded).not.toBeNull();
    expect(loaded!.issueId).toBe('PAN-399');
  });

  it('upsertMergeSetSync stores the canonical uppercase issue ID', () => {
    seedIssue('PAN-399');
    upsertMergeSetSync(makeMergeSet({ issueId: 'pan-399' }));

    const row = odb.raw().prepare('SELECT issue_id FROM merge_sets WHERE issue_id = ?').get('PAN-399') as { issue_id: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.issue_id).toBe('PAN-399');
  });

  it('deleteMergeSetSync normalizes lowercase IDs to uppercase', () => {
    seedIssue('PAN-399');
    upsertMergeSetSync(makeMergeSet());

    deleteMergeSetSync('pan-399');

    const row = odb.raw().prepare('SELECT issue_id FROM merge_sets WHERE issue_id = ?').get('PAN-399') as { issue_id: string } | undefined;
    expect(row).toBeUndefined();
  });
});
