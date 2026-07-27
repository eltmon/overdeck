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
  patchMergeSetRepoSync,
  patchMergeSetReposSync,
  upsertMergeSetSync,
  deleteMergeSetSync,
} from '../../../src/lib/merge-set.js';
import type { MergeSet, MergeSetRepoState } from '../../../src/lib/merge-set.js';

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

function repo(repoKey: string, patch: Partial<MergeSetRepoState> = {}): MergeSetRepoState {
  return {
    repoKey,
    repoPath: `/repo/${repoKey}`,
    forge: 'gitlab',
    sourceBranch: 'feature/pan-399',
    targetBranch: 'main',
    artifactUrl: `https://gitlab.com/org/${repoKey}/-/merge_requests/1`,
    artifactId: '1',
    reviewStatus: 'passed',
    testStatus: 'passed',
    rebaseStatus: 'pending',
    verificationStatus: 'pending',
    mergeStatus: 'pending',
    mergeOrder: 0,
    required: true,
    ...patch,
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

  it('patches one observed repo without overwriting concurrent sibling progress', () => {
    seedIssue('PAN-399');
    const observed = repo('fe');
    upsertMergeSetSync(makeMergeSet({ repos: [observed, repo('api')] }));
    upsertMergeSetSync(makeMergeSet({
      status: 'merging',
      repos: [
        observed,
        repo('api', {
          mergeStatus: 'merging',
          rebaseStatus: 'passed',
          verificationStatus: 'passed',
        }),
      ],
    }));

    const patched = patchMergeSetRepoSync('PAN-399', 'fe', observed, {
      artifactId: '1',
      artifactUrl: observed.artifactUrl,
      mergeStatus: 'merged',
    });
    const loaded = getMergeSetSync('PAN-399')!;

    expect(patched).toBe(true);
    expect(loaded.status).toBe('merging');
    expect(loaded.repos.find((entry) => entry.repoKey === 'fe')?.mergeStatus).toBe('merged');
    expect(loaded.repos.find((entry) => entry.repoKey === 'api')).toEqual(expect.objectContaining({
      mergeStatus: 'merging',
      rebaseStatus: 'passed',
      verificationStatus: 'passed',
    }));
  });

  it('rejects an observed patch when the current artifact changed', () => {
    seedIssue('PAN-399');
    const observed = repo('fe');
    upsertMergeSetSync(makeMergeSet({ repos: [repo('fe', { artifactId: '2' })] }));

    const patched = patchMergeSetRepoSync('PAN-399', 'fe', observed, { mergeStatus: 'merged' });

    expect(patched).toBe(false);
    expect(getMergeSetSync('PAN-399')?.repos[0]).toEqual(expect.objectContaining({
      artifactId: '2',
      mergeStatus: 'pending',
    }));
  });

  it('rolls back every repo patch when one batch comparison fails', () => {
    seedIssue('PAN-399');
    const observedFe = repo('fe');
    const observedApi = repo('api');
    upsertMergeSetSync(makeMergeSet({
      repos: [observedFe, repo('api', { artifactId: '2' })],
    }));

    const patched = patchMergeSetReposSync('PAN-399', [
      { repoKey: 'fe', expected: observedFe, patch: { mergeStatus: 'merged' } },
      { repoKey: 'api', expected: observedApi, patch: { mergeStatus: 'skipped' } },
    ]);
    const loaded = getMergeSetSync('PAN-399')!;

    expect(patched).toBe(false);
    expect(loaded.repos.find((entry) => entry.repoKey === 'fe')?.mergeStatus).toBe('pending');
    expect(loaded.repos.find((entry) => entry.repoKey === 'api')).toEqual(expect.objectContaining({
      artifactId: '2',
      mergeStatus: 'pending',
    }));
  });
});
