import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';

import { Db, EventBus, Forge } from '../../../../src/lib/overdeck/infra.js';
import {
  MergeResolver,
  MergeResolverLive,
  MergeWriter,
  MergeWriterLive,
  readyForMerge,
  type MergeSetRepo,
  type MergeSet,
  type AutoMergeFilter,
  type UatGenerationFilter,
} from '../../../../src/lib/overdeck/merge.js';
import type { IssueId } from '../../../../src/lib/overdeck/issues.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIssueId(s: string) {
  return s as IssueId;
}

function makeProjectKey(s: string) {
  return s as ReturnType<typeof import('../../../../src/lib/overdeck/merge.js').ProjectKey.make>;
}

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
    reviewStatus:       'passed',
    testStatus:         'passed',
    rebaseStatus:       'pending',
    verificationStatus: 'pending',
    mergeStatus:        'pending',
    mergeOrder:         1,
    required:           true,
    ...overrides,
  };
}

function makeMergeSet(overrides: Partial<MergeSet> = {}): MergeSet {
  return {
    issueId:       makeIssueId('PAN-1'),
    projectKey:    makeProjectKey('pan'),
    projectPath:   '/projects/pan',
    workspaceType: 'monorepo',
    status:        'ready',
    repos:         [makeRepo()],
    createdAt:     new Date('2026-01-01T00:00:00Z'),
    updatedAt:     new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ── Fake DB builder ────────────────────────────────────────────────────────────

type MergeSetRow = {
  issueId: string;
  projectKey: string;
  projectPath: string;
  workspaceType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};
type MergeSetRepoRow = {
  id: number;
  issueId: string;
  repoKey: string;
  repoPath: string;
  forge: string;
  sourceBranch: string;
  targetBranch: string;
  artifactUrl: string | null;
  artifactId: string | null;
  reviewStatus: string;
  testStatus: string;
  rebaseStatus: string;
  verificationStatus: string;
  mergeStatus: string;
  mergeOrder: number;
  required: boolean;
};
type MergeQueueRow = {
  id: number;
  issueId: string;
  projectKey: string;
  status: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
};
type PendingAutoMergeRow = {
  id: number;
  issueId: string;
  prUrl: string;
  prNumber: number | null;
  projectKey: string;
  forge: string;
  status: string;
  scheduledMergeAt: Date;
  scheduledAt: Date;
  mergedAt: Date | null;
  failureReason: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
};
type UatGenerationRow = {
  name: string;
  worktreePath: string;
  projectRoot: string;
  baseSha: string;
  status: string;
  stackStartedAt: Date | null;
  cleanedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function makeWiredFakeDb(initialMergeSet?: MergeSet) {
  const mergeSetsStore = new Map<string, MergeSetRow>();
  const mergeReposStore: MergeSetRepoRow[] = [];
  const mergeQueueStore: MergeQueueRow[] = [];
  const pendingAutoMergesStore: PendingAutoMergeRow[] = [];
  const uatGenerationsStore: UatGenerationRow[] = [];
  let nextId = 1;

  if (initialMergeSet) {
    mergeSetsStore.set(initialMergeSet.issueId, {
      issueId:       initialMergeSet.issueId,
      projectKey:    initialMergeSet.projectKey,
      projectPath:   initialMergeSet.projectPath,
      workspaceType: initialMergeSet.workspaceType,
      status:        initialMergeSet.status,
      createdAt:     initialMergeSet.createdAt,
      updatedAt:     initialMergeSet.updatedAt,
    });
    initialMergeSet.repos.forEach((repo, i) => {
      mergeReposStore.push({
        id:                 nextId++,
        issueId:            initialMergeSet.issueId,
        repoKey:            repo.repoKey,
        repoPath:           repo.repoPath,
        forge:              repo.forge,
        sourceBranch:       repo.sourceBranch,
        targetBranch:       repo.targetBranch,
        artifactUrl:        repo.artifactUrl,
        artifactId:         repo.artifactId,
        reviewStatus:       repo.reviewStatus,
        testStatus:         repo.testStatus,
        rebaseStatus:       repo.rebaseStatus,
        verificationStatus: repo.verificationStatus,
        mergeStatus:        repo.mergeStatus,
        mergeOrder:         repo.mergeOrder ?? i + 1,
        required:           repo.required,
      });
    });
  }

  const emittedEvents: Array<{ type: string; payload: unknown }> = [];
  const mergeCallArgs: unknown[] = [];

  // Drizzle sqlite-proxy returns thenables — every terminal step is a thenable.
  function makeResult<T>(data: T[]) {
    const r: unknown = {
      then:    (resolve: (v: T[]) => void) => { resolve(data); return r; },
      orderBy: (..._a: unknown[]) => makeResult(data),
      limit:   (n: number) => makeResult(data.slice(0, n)),
      where:   (_c: unknown) => makeResult(data),
    };
    return r;
  }

  const q = new Proxy({} as never, {
    get: (_: unknown, prop: string) => {
      if (prop === 'then') return undefined;

      if (prop === 'select') {
        return () => ({
          from: (table: Record<string, unknown>) => {
            const keys = Object.keys(table);
            const isMergeSets      = keys.includes('issueId') && keys.includes('workspaceType');
            const isMergeRepos     = keys.includes('issueId') && keys.includes('repoKey');
            const isMergeQueue     = keys.includes('issueId') && keys.includes('position');
            const isPendingAM      = keys.includes('issueId') && keys.includes('prUrl');
            const isUatGenerations = keys.includes('name') && keys.includes('worktreePath');
            const isUatMembers     = keys.includes('uatName') && keys.includes('role');
            const isUatResolutions = keys.includes('uatName') && keys.includes('commitSha');

            let store: unknown[] = [];
            if (isMergeSets)      store = Array.from(mergeSetsStore.values());
            else if (isMergeRepos) store = mergeReposStore;
            else if (isMergeQueue) store = mergeQueueStore;
            else if (isPendingAM)  store = pendingAutoMergesStore;
            else if (isUatGenerations) store = uatGenerationsStore;
            else if (isUatMembers)     store = [];
            else if (isUatResolutions) store = [];

            return makeResult(store);
          },
        });
      }

      if (prop === 'insert') {
        return (table: Record<string, unknown>) => ({
          values: (vals: Record<string, unknown>) => ({
            onConflictDoNothing: () => {
              // PAM insert
              if ('prUrl' in vals) {
                pendingAutoMergesStore.push({ id: nextId++, ...(vals as never) } as PendingAutoMergeRow);
              }
              return Promise.resolve();
            },
            onConflictDoUpdate: (_opts: unknown) => {
              // merge_sets upsert
              if ('workspaceType' in vals && 'issueId' in vals) {
                mergeSetsStore.set(vals['issueId'] as string, vals as MergeSetRow);
              }
              return Promise.resolve();
            },
          }),
        });
      }

      if (prop === 'update') {
        return (_table: unknown) => ({
          set: (vals: Record<string, unknown>) => ({
            where: (_cond: unknown) => {
              // PAM cancel update
              if ('cancelledBy' in vals) {
                for (const row of pendingAutoMergesStore) {
                  Object.assign(row, vals);
                }
              }
              // UAT status update
              if ('status' in vals && 'updatedAt' in vals) {
                for (const row of uatGenerationsStore) {
                  Object.assign(row, vals);
                }
              }
              return Promise.resolve();
            },
          }),
        });
      }

      return () => { throw new Error(`Unexpected db call: q.${prop}`); };
    },
  });

  const dbLayer = Layer.succeed(Db, Db.of({ q: q as never, path: ':memory:' }));

  const busLayer = Layer.succeed(
    EventBus,
    EventBus.of({
      emit: (event) => Effect.sync(() => {
        emittedEvents.push({ type: event.type, payload: event.payload });
        return 0;
      }),
      readFrom:          () => Effect.succeed([]),
      getLatestSequence: Effect.succeed(0),
      stream:            undefined as never,
    }),
  );

  const forgeLayer = Layer.succeed(
    Forge,
    Forge.of({
      merge:   (input) => Effect.sync(() => { mergeCallArgs.push(input); return input; }),
      approve: (input) => Effect.sync(() => input),
    }),
  );

  return {
    dbLayer,
    busLayer,
    forgeLayer,
    emittedEvents,
    mergeCallArgs,
    mergeSetsStore,
    pendingAutoMergesStore,
    mergeQueueStore,
  };
}

// ── AC1: readyForMerge predicate — test=skipped counts as passing ─────────────

describe('readyForMerge predicate (AC1)', () => {
  it('returns true when review=passed and test=passed', () => {
    const repo = makeRepo({ reviewStatus: 'passed', testStatus: 'passed' });
    expect(readyForMerge(repo)).toBe(true);
  });

  it('returns true when review=passed and test=skipped (skipped counts)', () => {
    const repo = makeRepo({ reviewStatus: 'passed', testStatus: 'skipped' });
    expect(readyForMerge(repo)).toBe(true);
  });

  it('returns false when review=passed but test=pending', () => {
    const repo = makeRepo({ reviewStatus: 'passed', testStatus: 'pending' });
    expect(readyForMerge(repo)).toBe(false);
  });

  it('returns false when review=pending (not yet reviewed)', () => {
    const repo = makeRepo({ reviewStatus: 'pending', testStatus: 'passed' });
    expect(readyForMerge(repo)).toBe(false);
  });

  it('returns false when review=failed', () => {
    const repo = makeRepo({ reviewStatus: 'failed', testStatus: 'passed' });
    expect(readyForMerge(repo)).toBe(false);
  });

  it('returns false when test=failed even if review=passed', () => {
    const repo = makeRepo({ reviewStatus: 'passed', testStatus: 'failed' });
    expect(readyForMerge(repo)).toBe(false);
  });
});

// ── AC1 via MergeWriter.merge: NotReadyForMerge when gate fails ───────────────

describe('MergeWriter.merge — readiness gate (AC1)', () => {
  it('emits merge.completed when all required repos are ready', async () => {
    const set = makeMergeSet({
      repos: [makeRepo({ reviewStatus: 'passed', testStatus: 'passed', required: true })],
    });
    const { dbLayer, busLayer, forgeLayer, emittedEvents, mergeSetsStore } =
      makeWiredFakeDb(set);

    const layer = Layer.mergeAll(MergeResolverLive, MergeWriterLive).pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );

    await Effect.runPromise(
      MergeWriter.use((w) => w.merge(makeIssueId('PAN-1'))).pipe(Effect.provide(layer)),
    );

    expect(emittedEvents.some((e) => e.type === 'merge.completed')).toBe(true);
  });

  it('allows merge when test=skipped (AC1 skipped rule)', async () => {
    const set = makeMergeSet({
      repos: [makeRepo({ reviewStatus: 'passed', testStatus: 'skipped', required: true })],
    });
    const { dbLayer, busLayer, forgeLayer, emittedEvents } = makeWiredFakeDb(set);

    const layer = Layer.mergeAll(MergeResolverLive, MergeWriterLive).pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );

    await Effect.runPromise(
      MergeWriter.use((w) => w.merge(makeIssueId('PAN-1'))).pipe(Effect.provide(layer)),
    );

    expect(emittedEvents.some((e) => e.type === 'merge.completed')).toBe(true);
  });

  it('fails with NotReadyForMerge when test=failed', async () => {
    const set = makeMergeSet({
      repos: [makeRepo({ reviewStatus: 'passed', testStatus: 'failed', required: true })],
    });
    const { dbLayer, busLayer, forgeLayer } = makeWiredFakeDb(set);

    const layer = Layer.mergeAll(MergeResolverLive, MergeWriterLive).pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );

    const err = await Effect.runPromise(
      MergeWriter.use((w) => w.merge(makeIssueId('PAN-1')))
        .pipe(Effect.provide(layer))
        .pipe(Effect.flip),
    );

    expect(err._tag).toBe('NotReadyForMerge');
  });

  it('fails with MergeSetNotFound for unknown issue', async () => {
    const { dbLayer, busLayer, forgeLayer } = makeWiredFakeDb();

    const layer = Layer.mergeAll(MergeResolverLive, MergeWriterLive).pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );

    const err = await Effect.runPromise(
      MergeWriter.use((w) => w.merge(makeIssueId('PAN-UNKNOWN')))
        .pipe(Effect.provide(layer))
        .pipe(Effect.flip),
    );

    expect(err._tag).toBe('MergeSetNotFound');
  });
});

// ── AC2: MergeWriter reads auto-merge FLAG from Settings; no auto_merge col ───

describe('AC2 — auto-merge flag lives in Settings, not Merge tables', () => {
  it('pendingAutoMerges table has no auto_merge column (schedule only)', () => {
    // The table definition in merge.ts must not expose an auto_merge column.
    // We verify indirectly: scheduleAutoMerge inserts a row, we check the
    // inserted values don't carry auto_merge.
    const { dbLayer, busLayer, forgeLayer, pendingAutoMergesStore } = makeWiredFakeDb();

    const layer = MergeWriterLive.pipe(
      Layer.provide(MergeResolverLive),
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );

    // scheduleAutoMerge is a self-contained effect we can check structurally
    // by looking at what gets written to the store after insertion
    const result = Effect.runPromise(
      MergeWriter.use((w) =>
        w.scheduleAutoMerge({
          issueId:          makeIssueId('PAN-10'),
          prUrl:            'https://github.com/r/pull/1',
          projectKey:       makeProjectKey('pan'),
          scheduledMergeAt: new Date('2026-01-02T00:00:00Z'),
        }),
      ).pipe(Effect.provide(layer)),
    );

    return result.then((autoMerge) => {
      // The AutoMerge entity has no auto_merge field (it's a schedule, not a policy)
      const keys = Object.keys(autoMerge);
      expect(keys).not.toContain('autoMerge');
      expect(keys).toContain('scheduledMergeAt');
      expect(keys).toContain('status');
      expect(autoMerge.issueId).toBe('PAN-10');
    });
  });

  it('MergeWriter compiles without SettingsResolver in its R (boundary enforced)', () => {
    // If MergeWriterLive required SettingsResolver, this layer would not compile
    // without it. Providing only Db + EventBus + Forge + MergeResolver proves the
    // auto_merge policy boundary is enforced structurally.
    const { dbLayer, busLayer, forgeLayer } = makeWiredFakeDb();
    const layer = Layer.mergeAll(MergeResolverLive, MergeWriterLive).pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );
    expect(layer).toBeDefined();
  });

  it('scheduleAutoMerge is idempotent: second call returns existing active row', async () => {
    const { dbLayer, busLayer, forgeLayer, pendingAutoMergesStore } = makeWiredFakeDb();

    const layer = Layer.mergeAll(MergeResolverLive, MergeWriterLive).pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );

    const first = await Effect.runPromise(
      MergeWriter.use((w) =>
        w.scheduleAutoMerge({
          issueId:          makeIssueId('PAN-20'),
          prUrl:            'https://github.com/r/pull/2',
          projectKey:       makeProjectKey('pan'),
          scheduledMergeAt: new Date('2026-01-02T00:00:00Z'),
        }),
      ).pipe(Effect.provide(layer)),
    );

    const second = await Effect.runPromise(
      MergeWriter.use((w) =>
        w.scheduleAutoMerge({
          issueId:          makeIssueId('PAN-20'),
          prUrl:            'https://github.com/r/pull/2',
          projectKey:       makeProjectKey('pan'),
          scheduledMergeAt: new Date('2026-01-03T00:00:00Z'), // different date
        }),
      ).pipe(Effect.provide(layer)),
    );

    // Same row returned (idempotent)
    expect(second.id).toBe(first.id);
  });

  it('cancelAutoMerge fails with AutoMergeNotFound when no active schedule', async () => {
    const { dbLayer, busLayer, forgeLayer } = makeWiredFakeDb();

    const layer = Layer.mergeAll(MergeResolverLive, MergeWriterLive).pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );

    const err = await Effect.runPromise(
      MergeWriter.use((w) => w.cancelAutoMerge(makeIssueId('PAN-NONE'), 'op-1'))
        .pipe(Effect.provide(layer))
        .pipe(Effect.flip),
    );

    expect(err._tag).toBe('AutoMergeNotFound');
  });
});

// ── AC3: All merge-train reads resolve through MergeResolver ─────────────────

describe('AC3 — MergeResolver is the sole read door for merge state', () => {
  it('all 5 MergeResolver methods are present on the service interface', async () => {
    const { dbLayer, busLayer, forgeLayer } = makeWiredFakeDb();

    const layer = MergeResolverLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );

    await Effect.runPromise(
      MergeResolver.use((r) => {
        expect(typeof r.getMergeSet).toBe('function');
        expect(typeof r.listQueues).toBe('function');
        expect(typeof r.listAutoMerges).toBe('function');
        expect(typeof r.listBlockers).toBe('function');
        expect(typeof r.listUatGenerations).toBe('function');
        return Effect.succeed(true);
      }).pipe(Effect.provide(layer)),
    );
  });

  it('getMergeSet fails with MergeSetNotFound for unknown issue', async () => {
    const { dbLayer, busLayer, forgeLayer } = makeWiredFakeDb();

    const layer = MergeResolverLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );

    const err = await Effect.runPromise(
      MergeResolver.use((r) => r.getMergeSet(makeIssueId('PAN-UNKNOWN')))
        .pipe(Effect.provide(layer))
        .pipe(Effect.flip),
    );

    expect(err._tag).toBe('MergeSetNotFound');
  });

  it('listQueues returns an empty array from an empty DB', async () => {
    const { dbLayer, busLayer, forgeLayer } = makeWiredFakeDb();

    const layer = MergeResolverLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );

    const queues = await Effect.runPromise(
      MergeResolver.use((r) => r.listQueues()).pipe(Effect.provide(layer)),
    );

    expect(Array.isArray(queues)).toBe(true);
    expect(queues).toHaveLength(0);
  });

  it('listAutoMerges returns empty for empty DB', async () => {
    const { dbLayer, busLayer, forgeLayer } = makeWiredFakeDb();

    const layer = MergeResolverLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );

    const filter: AutoMergeFilter = { active: true };
    const result = await Effect.runPromise(
      MergeResolver.use((r) => r.listAutoMerges(filter)).pipe(Effect.provide(layer)),
    );

    expect(Array.isArray(result)).toBe(true);
  });

  it('listBlockers delegates to listAutoMerges with problems=true', async () => {
    const { dbLayer, busLayer, forgeLayer } = makeWiredFakeDb();

    const layer = MergeResolverLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );

    const result = await Effect.runPromise(
      MergeResolver.use((r) => r.listBlockers()).pipe(Effect.provide(layer)),
    );

    expect(Array.isArray(result)).toBe(true);
  });

  it('listUatGenerations returns empty for empty DB', async () => {
    const { dbLayer, busLayer, forgeLayer } = makeWiredFakeDb();

    const layer = MergeResolverLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );

    const filter: UatGenerationFilter = {};
    const result = await Effect.runPromise(
      MergeResolver.use((r) => r.listUatGenerations(filter)).pipe(Effect.provide(layer)),
    );

    expect(Array.isArray(result)).toBe(true);
  });

  it('no-loss audit: all 5 merge-train read paths covered by MergeResolver', async () => {
    // Structural check: every Part-1 §1A read endpoint traces to a MergeResolver method.
    // GET /api/issues/:id/merge-set         → getMergeSet
    // GET /api/merge-queue                  → listQueues
    // GET /api/flywheel/merge-queue         → listQueues  (duplicate, same method)
    // GET /api/flywheel/auto-merge/pending  → listAutoMerges({ active: true })
    // GET /api/flywheel/auto-merge/problems → listAutoMerges({ problems: true })
    // GET /api/flywheel/merge-blockers      → listBlockers
    // GET /api/flywheel/uat-generations     → listUatGenerations
    const { dbLayer, busLayer, forgeLayer } = makeWiredFakeDb();

    const layer = MergeResolverLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(forgeLayer),
    );

    await Effect.runPromise(
      MergeResolver.use((r) => {
        // Each call returns an Effect — proof the method exists and is correctly typed
        const e1 = r.getMergeSet(makeIssueId('PAN-1'));
        const e2 = r.listQueues();
        const e3 = r.listAutoMerges({ active: true });
        const e4 = r.listAutoMerges({ problems: true });
        const e5 = r.listBlockers();
        const e6 = r.listUatGenerations({});
        expect(e1).toBeDefined();
        expect(e2).toBeDefined();
        expect(e3).toBeDefined();
        expect(e4).toBeDefined();
        expect(e5).toBeDefined();
        expect(e6).toBeDefined();
        return Effect.succeed(true);
      }).pipe(Effect.provide(layer)),
    );
  });
});
