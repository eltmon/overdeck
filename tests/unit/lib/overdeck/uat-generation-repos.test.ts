/**
 * Tests for per-repo UAT generation state (PAN-3093).
 *
 * A polyrepo generation spans N member repos, each with its own uat branch,
 * base SHA, and worktree, so that state lives in the `uat_generation_repos` /
 * `uat_generation_member_repos` child tables rather than the single-valued
 * columns on `uat_generations`. These tests cover the store round-trip, the
 * N=1 synthesis that keeps monorepo and pre-migration rows readable, and the
 * idempotency of the schema top-up that adds the tables to an existing db.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';
import {
  closeOverdeckDatabaseSync,
  getOverdeckDatabaseSync,
} from '../../../../src/lib/overdeck/infra.js';

import {
  insertUatGenerationSync,
  getUatGenerationSync,
  listUatGenerationsSync,
  updateUatGenerationSync,
  markUatGenerationRepoPromotedSync,
  type UatGeneration,
} from '../../../../src/lib/overdeck/merge-sync.js';

let odb: OverdeckTestDb;

beforeEach(() => { odb = setupOverdeckTestDb(); });
afterEach(()  => { teardownOverdeckTestDb(odb); });

/** uat_generation_members and uat_generation_member_repos both FK to issues. */
function seedIssue(db: ReturnType<typeof odb.raw>, id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, 'open', ?)",
  ).run(id, Date.now());
}

/**
 * A two-repo generation: MIN-901 contributes to both `fe` and `api`,
 * MIN-902 to `api` only — the shape the issue describes for mind-your-now.
 */
function makePolyrepoGeneration(
  overrides: Partial<UatGeneration> = {},
): Omit<UatGeneration, 'createdAt' | 'updatedAt'> & { createdAt?: string } {
  return {
    name: 'uat/min-otter-0727',
    worktreePath: '/tmp/myn/workspaces/uat-min-otter-0727',
    projectRoot: '/tmp/myn',
    baseSha: 'fe@aaa1111 api@bbb2222',
    status: 'ready',
    repos: [
      {
        repoKey: 'fe',
        repoPath: '/tmp/myn/frontend',
        branch: 'uat/min-otter-0727',
        baseSha: 'aaa1111',
        targetBranch: 'main',
        worktreePath: '/tmp/myn/workspaces/uat-min-otter-0727/fe',
        mergeOrder: 0,
      },
      {
        repoKey: 'api',
        repoPath: '/tmp/myn/api',
        branch: 'uat/min-otter-0727',
        baseSha: 'bbb2222',
        targetBranch: 'main',
        worktreePath: '/tmp/myn/workspaces/uat-min-otter-0727/api',
        mergeOrder: 1,
      },
    ],
    members: [
      {
        issueId: 'MIN-901',
        title: 'Spans both repos',
        branch: 'feature/min-901',
        headSha: 'ccc3333',
        mergeOrder: 1,
        repos: [
          { repoKey: 'fe',  branch: 'feature/min-901', headSha: 'fe901', mergeOrderInRepo: 1 },
          { repoKey: 'api', branch: 'feature/min-901', headSha: 'api901', mergeOrderInRepo: 1 },
        ],
      },
      {
        issueId: 'MIN-902',
        title: 'Api only',
        branch: 'feature/min-902',
        headSha: 'ddd4444',
        mergeOrder: 2,
        repos: [
          { repoKey: 'api', branch: 'feature/min-902', headSha: 'api902', mergeOrderInRepo: 2 },
        ],
      },
    ],
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    ...overrides,
  };
}

/** A pre-PAN-3093 / monorepo generation: no per-repo rows at all. */
function makeLegacyGeneration(): Omit<UatGeneration, 'createdAt' | 'updatedAt'> & { createdAt?: string } {
  return {
    name: 'uat/pan-otter-0610',
    worktreePath: '/tmp/project/workspaces/uat-pan-otter-0610',
    projectRoot: '/tmp/project',
    baseSha: 'abc123',
    status: 'ready',
    members: [
      { issueId: 'PAN-1', title: 'Only feature', branch: 'feature/pan-1', headSha: 'aaa111', mergeOrder: 1 },
    ],
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
  };
}

describe('per-repo generation round-trip', () => {
  it('returns both repos with distinct base SHAs and each member\'s per-repo branches', () => {
    const db = odb.raw();
    seedIssue(db, 'MIN-901');
    seedIssue(db, 'MIN-902');

    const gen = makePolyrepoGeneration();
    insertUatGenerationSync(gen);

    const loaded = getUatGenerationSync(gen.name)!;

    expect(loaded.repos).toHaveLength(2);
    expect(loaded.repos!.map((r) => r.repoKey)).toEqual(['fe', 'api']);
    expect(loaded.repos!.map((r) => r.baseSha)).toEqual(['aaa1111', 'bbb2222']);
    expect(loaded.repos![0]).toMatchObject({
      repoPath: '/tmp/myn/frontend',
      branch: 'uat/min-otter-0727',
      worktreePath: '/tmp/myn/workspaces/uat-min-otter-0727/fe',
      mergeOrder: 0,
      promotedAt: null,
    });

    // The composite anchor stays on the generation row for staleness checks.
    expect(loaded.baseSha).toBe('fe@aaa1111 api@bbb2222');

    const min901 = loaded.members.find((m) => m.issueId === 'MIN-901')!;
    expect(min901.repos).toEqual([
      { repoKey: 'fe',  branch: 'feature/min-901', headSha: 'fe901',  mergeOrderInRepo: 1 },
      { repoKey: 'api', branch: 'feature/min-901', headSha: 'api901', mergeOrderInRepo: 1 },
    ]);

    const min902 = loaded.members.find((m) => m.issueId === 'MIN-902')!;
    expect(min902.repos).toEqual([
      { repoKey: 'api', branch: 'feature/min-902', headSha: 'api902', mergeOrderInRepo: 2 },
    ]);
  });

  it('orders repos by merge order on read regardless of insert order', () => {
    const db = odb.raw();
    seedIssue(db, 'MIN-901');
    seedIssue(db, 'MIN-902');

    const gen = makePolyrepoGeneration();
    // Hand the writer the repos back-to-front; read order must still follow mergeOrder.
    insertUatGenerationSync({ ...gen, repos: [...gen.repos!].reverse() });

    expect(getUatGenerationSync(gen.name)!.repos!.map((r) => r.repoKey)).toEqual(['fe', 'api']);
  });

  it('carries repos through listUatGenerationsSync', () => {
    const db = odb.raw();
    seedIssue(db, 'MIN-901');
    seedIssue(db, 'MIN-902');
    insertUatGenerationSync(makePolyrepoGeneration());

    const listed = listUatGenerationsSync({ projectRoot: '/tmp/myn' });
    expect(listed).toHaveLength(1);
    expect(listed[0].repos!.map((r) => r.repoKey)).toEqual(['fe', 'api']);
  });

  it('replaces per-repo rows when the same generation name is re-assembled', () => {
    const db = odb.raw();
    seedIssue(db, 'MIN-901');
    seedIssue(db, 'MIN-902');

    insertUatGenerationSync(makePolyrepoGeneration());

    // Rebuild of the same deterministic daily name, now only one repo contributes.
    const rebuilt = makePolyrepoGeneration({
      baseSha: 'api@eee5555',
      repos: [{
        repoKey: 'api',
        repoPath: '/tmp/myn/api',
        branch: 'uat/min-otter-0727',
        baseSha: 'eee5555',
        targetBranch: 'main',
        worktreePath: '/tmp/myn/workspaces/uat-min-otter-0727/api',
        mergeOrder: 0,
      }],
      members: [{
        issueId: 'MIN-902',
        title: 'Api only',
        branch: 'feature/min-902',
        headSha: 'ddd4444',
        mergeOrder: 1,
        repos: [{ repoKey: 'api', branch: 'feature/min-902', headSha: 'api902', mergeOrderInRepo: 1 }],
      }],
    });
    insertUatGenerationSync(rebuilt);

    const loaded = getUatGenerationSync('uat/min-otter-0727')!;
    expect(loaded.repos!.map((r) => r.repoKey)).toEqual(['api']);
    expect(loaded.members.map((m) => m.issueId)).toEqual(['MIN-902']);
  });
});

describe('legacy and monorepo rows synthesize a single repo', () => {
  it('yields exactly one entry built from base_sha and worktree_path', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');

    const gen = makeLegacyGeneration();
    insertUatGenerationSync(gen);

    const loaded = getUatGenerationSync(gen.name)!;
    expect(loaded.repos).toEqual([{
      repoKey: 'project',
      repoPath: '/tmp/project',
      branch: 'uat/pan-otter-0610',
      baseSha: 'abc123',
      targetBranch: 'main',
      worktreePath: '/tmp/project/workspaces/uat-pan-otter-0610',
      mergeOrder: 0,
      promotedAt: null,
      mergeSha: null,
    }]);
  });

  it('leaves members without per-repo contributions undefined', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    insertUatGenerationSync(makeLegacyGeneration());

    expect(getUatGenerationSync('uat/pan-otter-0610')!.members[0].repos).toBeUndefined();
  });
});

describe('updateUatGenerationSync with per-repo state', () => {
  it('replaces repo rows when repos are patched', () => {
    const db = odb.raw();
    seedIssue(db, 'MIN-901');
    seedIssue(db, 'MIN-902');
    const gen = makePolyrepoGeneration();
    insertUatGenerationSync(gen);

    updateUatGenerationSync(gen.name, {
      repos: [{
        repoKey: 'api',
        repoPath: '/tmp/myn/api',
        branch: 'uat/min-otter-0727',
        baseSha: 'fff6666',
        targetBranch: 'main',
        worktreePath: '/tmp/myn/workspaces/uat-min-otter-0727/api',
        mergeOrder: 0,
      }],
    });

    const loaded = getUatGenerationSync(gen.name)!;
    expect(loaded.repos!.map((r) => r.repoKey)).toEqual(['api']);
    expect(loaded.repos![0].baseSha).toBe('fff6666');
  });

  it('preserves member contributions when only heldOut is patched', () => {
    const db = odb.raw();
    seedIssue(db, 'MIN-901');
    seedIssue(db, 'MIN-902');
    seedIssue(db, 'MIN-903');
    const gen = makePolyrepoGeneration();
    insertUatGenerationSync(gen);

    // heldOut-only patches reconstruct members from rows that carry no repo
    // data — the contributions must survive that rebuild.
    updateUatGenerationSync(gen.name, {
      heldOut: [{ issueId: 'MIN-903', reason: 'conflict in api could not be resolved' }],
    });

    const loaded = getUatGenerationSync(gen.name)!;
    expect(loaded.heldOut).toEqual([
      { issueId: 'MIN-903', reason: 'conflict in api could not be resolved' },
    ]);
    expect(loaded.members.find((m) => m.issueId === 'MIN-901')!.repos).toHaveLength(2);
  });
});

describe('per-repo target branch and merge sha', () => {
  it('round-trips a non-main target branch', async () => {
    const db = odb.raw();
    seedIssue(db, 'MIN-901');
    seedIssue(db, 'MIN-902');
    const gen = makePolyrepoGeneration();
    // api merges into develop, not main — promote must publish there.
    insertUatGenerationSync({
      ...gen,
      repos: gen.repos!.map((r) => (r.repoKey === 'api' ? { ...r, targetBranch: 'develop' } : r)),
    });

    const loaded = getUatGenerationSync(gen.name)!;
    expect(loaded.repos!.find((r) => r.repoKey === 'api')!.targetBranch).toBe('develop');
    expect(loaded.repos!.find((r) => r.repoKey === 'fe')!.targetBranch).toBe('main');
  });

  it('stamps the merge sha alongside promoted_at so a resumed promote can finalize', async () => {
    const db = odb.raw();
    seedIssue(db, 'MIN-901');
    seedIssue(db, 'MIN-902');
    const gen = makePolyrepoGeneration();
    insertUatGenerationSync(gen);

    markUatGenerationRepoPromotedSync(gen.name, 'fe', '2026-07-27T10:00:00.000Z', 'fe1234567890');

    const fe = getUatGenerationSync(gen.name)!.repos!.find((r) => r.repoKey === 'fe')!;
    expect(fe.promotedAt).toBe('2026-07-27T10:00:00.000Z');
    expect(fe.mergeSha).toBe('fe1234567890');
  });

  it('keeps an existing merge sha when a later stamp omits it', async () => {
    const db = odb.raw();
    seedIssue(db, 'MIN-901');
    seedIssue(db, 'MIN-902');
    const gen = makePolyrepoGeneration();
    insertUatGenerationSync(gen);

    markUatGenerationRepoPromotedSync(gen.name, 'fe', '2026-07-27T10:00:00.000Z', 'fe1234567890');
    markUatGenerationRepoPromotedSync(gen.name, 'fe', '2026-07-27T11:00:00.000Z');

    expect(getUatGenerationSync(gen.name)!.repos!.find((r) => r.repoKey === 'fe')!.mergeSha)
      .toBe('fe1234567890');
  });
});

describe('markUatGenerationRepoPromotedSync', () => {
  it('stamps promoted_at on one repo and leaves the others pending', () => {
    const db = odb.raw();
    seedIssue(db, 'MIN-901');
    seedIssue(db, 'MIN-902');
    const gen = makePolyrepoGeneration();
    insertUatGenerationSync(gen);

    markUatGenerationRepoPromotedSync(gen.name, 'fe', '2026-07-27T10:00:00.000Z');

    const loaded = getUatGenerationSync(gen.name)!;
    expect(loaded.repos!.find((r) => r.repoKey === 'fe')!.promotedAt).toBe('2026-07-27T10:00:00.000Z');
    expect(loaded.repos!.find((r) => r.repoKey === 'api')!.promotedAt).toBeNull();
  });

  it('throws when the repo is not part of the generation', () => {
    const db = odb.raw();
    seedIssue(db, 'MIN-901');
    seedIssue(db, 'MIN-902');
    const gen = makePolyrepoGeneration();
    insertUatGenerationSync(gen);

    expect(() => markUatGenerationRepoPromotedSync(gen.name, 'infra', '2026-07-27T10:00:00.000Z'))
      .toThrow(/uat generation repo not found/);
  });
});

describe('schema top-up idempotency', () => {
  it('adds the tables again on a second open without error or duplicate rows', () => {
    const db = odb.raw();
    seedIssue(db, 'MIN-901');
    seedIssue(db, 'MIN-902');
    insertUatGenerationSync(makePolyrepoGeneration());

    // Re-opening runs ensureRuntimeIndexesSync — and so the per-repo table
    // top-up — a second time against a db that already has the tables.
    closeOverdeckDatabaseSync();
    const reopened = getOverdeckDatabaseSync(odb.dbPath);

    const repoCount = reopened
      .prepare('SELECT COUNT(*) AS n FROM uat_generation_repos')
      .get() as { n: number };
    const memberRepoCount = reopened
      .prepare('SELECT COUNT(*) AS n FROM uat_generation_member_repos')
      .get() as { n: number };

    expect(repoCount.n).toBe(2);
    expect(memberRepoCount.n).toBe(3);
    expect(getUatGenerationSync('uat/min-otter-0727')!.repos).toHaveLength(2);
  });
});
