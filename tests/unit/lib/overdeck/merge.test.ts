import { describe, it, expect } from 'vitest';

import {
  mergeReady,
  type MergeSetRepo,
} from '../../../../src/lib/overdeck/merge.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRepoKey(s: string) {
  return s as ReturnType<typeof import('../../../../src/lib/overdeck/merge.js').RepoKey.make>;
}

function makeUatName(s: string) {
  return s as ReturnType<typeof import('../../../../src/lib/overdeck/merge.js').UatName.make>;
}

function makeRepo(overrides: Partial<MergeSetRepo> = {}): MergeSetRepo {
  return {
    repoKey:            makeRepoKey('main-repo'),
    repoPath:           '/repos/main',
    forge:              'github',
    sourceBranch:       'feature/pan-1',
    targetBranch:       'main',
    artifactUrl:        null,
    artifactId:         null,
    repoReview:       'passed',
    repoTests:         'passed',
    rebaseStatus:       'pending',
    verificationStatus: 'pending',
    repoMerge:        'pending',
    mergeOrder:         1,
    required:           true,
    ...overrides,
  };
}

// ── Fake DB builder ────────────────────────────────────────────────────────────

// ── AC1: mergeReady predicate — test=skipped counts as passing ─────────────

describe('mergeReady predicate (AC1)', () => {
  it('returns true when review=passed and test=passed', () => {
    const repo = makeRepo({ repoReview: 'passed', repoTests: 'passed' });
    expect(mergeReady(repo)).toBe(true);
  });

  it('returns true when review=passed and test=skipped (skipped counts)', () => {
    const repo = makeRepo({ repoReview: 'passed', repoTests: 'skipped' });
    expect(mergeReady(repo)).toBe(true);
  });

  it('returns false when review=passed but test=pending', () => {
    const repo = makeRepo({ repoReview: 'passed', repoTests: 'pending' });
    expect(mergeReady(repo)).toBe(false);
  });

  it('returns false when review=pending (not yet reviewed)', () => {
    const repo = makeRepo({ repoReview: 'pending', repoTests: 'passed' });
    expect(mergeReady(repo)).toBe(false);
  });

  it('returns false when review=failed', () => {
    const repo = makeRepo({ repoReview: 'failed', repoTests: 'passed' });
    expect(mergeReady(repo)).toBe(false);
  });

  it('returns false when test=failed even if review=passed', () => {
    const repo = makeRepo({ repoReview: 'passed', repoTests: 'failed' });
    expect(mergeReady(repo)).toBe(false);
  });
});

// ── AC1 via MergeWriter.merge: NotReadyForMerge when gate fails ───────────────


// ── AC2: MergeWriter reads auto-merge FLAG from Settings; no auto_merge col ───


// ── AC3: All merge-train reads resolve through MergeResolver ─────────────────

