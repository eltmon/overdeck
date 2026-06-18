/**
 * Tests for merge-sync.ts merge set functions (PAN-1938).
 *
 * Ports merge-set-db.test.ts onto overdeck.db via setupOverdeckTestDb /
 * teardownOverdeckTestDb. Verifies upsert/get/list/delete round-trips and
 * that ISO timestamp strings survive the integer-column round-trip.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';
import {
  deleteMergeSet,
  getAllMergeSetsFromDb,
  getMergeSetFromDb,
  upsertMergeSet,
} from '../../../../src/lib/overdeck/merge-sync.js';
import type { MergeSet } from '../../../../src/lib/merge-set.js';

let odb: OverdeckTestDb;

beforeEach(() => { odb = setupOverdeckTestDb(); });
afterEach(()  => { teardownOverdeckTestDb(odb); });

// ── seed an issue row (FK required by merge_sets) ─────────────────────────────
function seedIssue(db: ReturnType<typeof odb.raw>, id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, 'open', ?)",
  ).run(id, Date.now());
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeMergeSet(overrides: Partial<MergeSet> = {}): MergeSet {
  return {
    issueId: 'PAN-632',
    projectKey: 'overdeck',
    projectPath: '/tmp/overdeck',
    workspaceType: 'polyrepo',
    status: 'draft',
    createdAt: '2026-04-11T12:00:00.000Z',
    updatedAt: '2026-04-11T12:00:00.000Z',
    repos: [
      {
        repoKey: 'frontend',
        repoPath: '/tmp/overdeck/frontend',
        forge: 'github',
        sourceBranch: 'feature/pan-632',
        targetBranch: 'main',
        reviewStatus: 'pending',
        testStatus: 'pending',
        rebaseStatus: 'pending',
        verificationStatus: 'pending',
        mergeStatus: 'pending',
        mergeOrder: 0,
        required: true,
      },
      {
        repoKey: 'api',
        repoPath: '/tmp/overdeck/api',
        forge: 'gitlab',
        sourceBranch: 'feature/pan-632',
        targetBranch: 'qa',
        reviewStatus: 'passed',
        testStatus: 'pending',
        rebaseStatus: 'pending',
        verificationStatus: 'pending',
        mergeStatus: 'pending',
        mergeOrder: 1,
        required: true,
      },
    ],
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('merge-sync merge sets', () => {
  it('persists a merge set and its repos', () => {
    seedIssue(odb.raw(), 'PAN-632');
    upsertMergeSet(makeMergeSet());

    const row = odb.raw().prepare('SELECT * FROM merge_sets WHERE issue_id = ?').get('PAN-632') as any;
    const repos = odb.raw().prepare('SELECT * FROM merge_set_repos WHERE issue_id = ? ORDER BY merge_order ASC').all('PAN-632') as any[];

    expect(row.project_key).toBe('overdeck');
    expect(repos).toHaveLength(2);
    expect(repos[0].repo_key).toBe('frontend');
    expect(repos[1].forge).toBe('gitlab');
  });

  it('ISO timestamps round-trip correctly via integer storage', () => {
    seedIssue(odb.raw(), 'PAN-632');
    upsertMergeSet(makeMergeSet({ createdAt: '2026-04-11T12:00:00.000Z', updatedAt: '2026-04-11T13:00:00.000Z' }));

    const loaded = getMergeSetFromDb('PAN-632');
    expect(loaded).not.toBeNull();
    expect(loaded!.createdAt).toBe('2026-04-11T12:00:00.000Z');
    expect(loaded!.updatedAt).toBe('2026-04-11T13:00:00.000Z');
  });

  it('replaces repo rows on update', () => {
    seedIssue(odb.raw(), 'PAN-632');
    upsertMergeSet(makeMergeSet());
    upsertMergeSet(makeMergeSet({
      status: 'ready',
      repos: [
        {
          repoKey: 'frontend',
          repoPath: '/tmp/overdeck/frontend',
          forge: 'github',
          sourceBranch: 'feature/pan-632',
          targetBranch: 'main',
          reviewStatus: 'passed',
          testStatus: 'passed',
          rebaseStatus: 'pending',
          verificationStatus: 'pending',
          mergeStatus: 'ready',
          mergeOrder: 0,
          required: true,
        },
      ],
    }));

    const result = getMergeSetFromDb('PAN-632');
    expect(result?.status).toBe('ready');
    expect(result?.repos).toHaveLength(1);
    expect(result?.repos[0].mergeStatus).toBe('ready');
  });

  it('lists all merge sets and filters by project', () => {
    seedIssue(odb.raw(), 'PAN-632');
    seedIssue(odb.raw(), 'MIN-632');
    upsertMergeSet(makeMergeSet({ issueId: 'PAN-632' }));
    upsertMergeSet(makeMergeSet({ issueId: 'MIN-632', projectKey: 'mind-your-now' }));

    expect(getAllMergeSetsFromDb()).toHaveLength(2);
    expect(getAllMergeSetsFromDb('mind-your-now')).toHaveLength(1);
    expect(getAllMergeSetsFromDb('mind-your-now')[0].issueId).toBe('MIN-632');
  });

  it('deletes merge sets and cascades repo rows', () => {
    seedIssue(odb.raw(), 'PAN-632');
    upsertMergeSet(makeMergeSet());
    deleteMergeSet('PAN-632');

    expect(getMergeSetFromDb('PAN-632')).toBeNull();
    const repos = odb.raw().prepare('SELECT * FROM merge_set_repos WHERE issue_id = ?').all('PAN-632');
    expect(repos).toHaveLength(0);
  });
});
