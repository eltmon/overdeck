import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';
import { initSchema } from '../../../../src/lib/database/schema.js';
import type { MergeSet } from '../../../../src/lib/merge-set.js';

let testDb: SqliteDatabase;

vi.mock('../../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

beforeEach(() => {
  testDb = openDatabase(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

import {
  deleteMergeSet,
  getAllMergeSetsFromDb,
  getMergeSetFromDb,
  upsertMergeSet,
} from '../../../../src/lib/database/merge-set-db.js';

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

describe('merge-set-db', () => {
  it('persists a merge set and its repos', () => {
    upsertMergeSet(makeMergeSet());

    const row = testDb.prepare('SELECT * FROM merge_sets WHERE issue_id = ?').get('PAN-632') as any;
    const repos = testDb.prepare('SELECT * FROM merge_set_repos WHERE issue_id = ? ORDER BY merge_order ASC').all('PAN-632') as any[];

    expect(row.project_key).toBe('overdeck');
    expect(repos).toHaveLength(2);
    expect(repos[0].repo_key).toBe('frontend');
    expect(repos[1].forge).toBe('gitlab');
  });

  it('replaces repo rows on update', () => {
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
    upsertMergeSet(makeMergeSet({ issueId: 'PAN-632' }));
    upsertMergeSet(makeMergeSet({ issueId: 'MIN-632', projectKey: 'mind-your-now' }));

    expect(getAllMergeSetsFromDb()).toHaveLength(2);
    expect(getAllMergeSetsFromDb('mind-your-now')).toHaveLength(1);
    expect(getAllMergeSetsFromDb('mind-your-now')[0].issueId).toBe('MIN-632');
  });

  it('deletes merge sets and cascades repo rows', () => {
    upsertMergeSet(makeMergeSet());
    deleteMergeSet('PAN-632');

    expect(getMergeSetFromDb('PAN-632')).toBeNull();
    const repos = testDb.prepare('SELECT * FROM merge_set_repos WHERE issue_id = ?').all('PAN-632');
    expect(repos).toHaveLength(0);
  });
});
