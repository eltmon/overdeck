/**
 * PAN-1696 merge-train-routes: the aggregate /api/merge-train/* namespace.
 *
 * These tests prove the decoupling claim directly: no flywheel run is created
 * or mocked anywhere in this file, so any route that still depended on a live
 * run's activePipeline would fail here.
 */

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const projectsMocks = vi.hoisted(() => ({
  listProjectsSync: vi.fn(),
  getProjectSync: vi.fn(),
}));

const mergeOrderMocks = vi.hoisted(() => ({
  listEligibleCandidatesByProject: vi.fn(() => [] as Array<{ issueId: string; title: string; pr?: number }>),
  computeMergeQueueFromCandidates: vi.fn(),
}));

const mergeSyncMocks = vi.hoisted(() => ({
  isMergeTrainEnabledForProject: vi.fn(() => true),
  getUatGenerationSync: vi.fn(() => ({
    name: 'uat/pan-otter-0610',
    projectRoot: '/repos/overdeck',
    status: 'promoted',
  })),
}));

const shipRecordMocks = vi.hoisted(() => {
  class ShipPromotedBatchError extends Error {
    constructor(readonly reason: string, message: string) {
      super(message);
    }
  }
  return {
    ShipPromotedBatchError,
    shipPromotedBatch: vi.fn(async () => ({
      status: 'passed', version: '48.8.0', batch: 'uat/pan-otter-0610', paths: [], at: '2026-07-31T00:00:00Z',
    })),
  };
});

const uatTrainMocks = vi.hoisted(() => ({
  getUatGenerationsPayload: vi.fn(async () => []),
  postUatGenerationStackPayload: vi.fn(async () => ({
    ok: true as const,
    frontendUrl: 'https://uat-pan-otter-0610.overdeck.localhost',
    evicted: [],
  })),
  postUatGenerationPromotePayload: vi.fn(async () => ({
    success: true as const,
    generation: 'uat/pan-otter-0610',
    mergeSha: 'merge-sha',
    members: ['PAN-1'],
    postMergeStarted: ['PAN-1'],
    invalidated: [],
  })),
  runUatTrainReconcile: vi.fn(async () => ({ action: 'assembled' as const, invalidated: [] })),
  runUatTrainReconcileAllProjects: vi.fn(async () => [
    { projectKey: 'overdeck', result: { action: 'assembled' as const, invalidated: [] } },
  ]),
}));

const mergeBatchMocks = vi.hoisted(() => ({
  shipMergeBatch: vi.fn(async (issueIds: readonly string[]) =>
    issueIds.map((issueId) => ({ issueId, ok: true as const })),
  ),
}));

const mergeEligibilityMocks = vi.hoisted(() => ({
  gatherMergeEligibility: vi.fn(async (issueIds: string[]) => new Map(issueIds.map((issueId) => [issueId, {
    issueId, bucket: 'in_flight', inPipeline: true, reasons: ['open PR'], labelDrift: null,
    lenses: { L1_openPr: true, L2_unmergedBranch: false, L3_issueOpen: true, L4_phaseLabel: null },
  }]))),
}));

vi.mock('../../../../lib/cloister/merge-eligibility.js', () => ({
  gatherMergeEligibility: mergeEligibilityMocks.gatherMergeEligibility,
  isMergeEligible: (membership: { bucket: string }) => membership.bucket === 'in_flight',
}));

/**
 * The real batch semantics, used by the ported PAN-1691 case: merge one at a
 * time and stop at the first failure, because everything after it would need
 * re-rebasing onto the new main.
 */
async function realShipMergeBatch(
  issueIds: readonly string[],
  deps: { merge: (id: string) => Promise<{ ok: true } | { ok: false; reason: string }> },
) {
  const outcomes: Array<{ issueId: string; result: string; reason?: string }> = [];
  let stopped = false;
  for (const issueId of issueIds) {
    if (stopped) { outcomes.push({ issueId, result: 'skipped' }); continue; }
    const r = await deps.merge(issueId);
    if (r.ok) outcomes.push({ issueId, result: 'merged' });
    else { outcomes.push({ issueId, result: 'failed', reason: r.reason }); stopped = true; }
  }
  return outcomes;
}

vi.mock('../../../../lib/projects.js', () => projectsMocks);
vi.mock('../../../../lib/flywheel-merge-order.js', () => mergeOrderMocks);
vi.mock('../../../../lib/overdeck/merge-sync.js', () => mergeSyncMocks);
vi.mock('../../../../lib/cloister/ship-record.js', () => shipRecordMocks);
vi.mock('../../services/uat-train.js', () => uatTrainMocks);
vi.mock('../../../../lib/cloister/merge-batch.js', () => mergeBatchMocks);
vi.mock('../specialists.js', () => ({ firePostMergeLifecycle: vi.fn(() => true) }));

const {
  mergeTrainRouteLayer,
  getMergeTrainQueuesPayload,
  getMergeTrainGenerationsPayload,
  postMergeTrainMergeNextPayload,
  postMergeTrainAssemblePayload,
} = await import('../merge-train.js');

const {
  DASHBOARD_CSRF_HEADER,
  DASHBOARD_SESSION_COOKIE,
  _resetDashboardSessionTokenForTests,
  dashboardCsrfToken,
  dashboardSessionCookieHeader,
} = await import('../dashboard-auth.js');

const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../../lib/internal-token.js');

interface RouteResult {
  status: number;
  body: unknown;
}

async function requestMergeTrainRoute(path: string, init: RequestInit = {}): Promise<RouteResult> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(mergeTrainRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

/** A mutation request carrying the dashboard session cookie + matching CSRF header. */
function authedInit(body: unknown = {}): RequestInit {
  const cookie = dashboardSessionCookieHeader().split(';')[0]!;
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: `${DASHBOARD_SESSION_COOKIE}=${cookie.split('=')[1]}`,
      [DASHBOARD_CSRF_HEADER]: dashboardCsrfToken(),
      origin: 'http://localhost:3011',
    },
    body: JSON.stringify(body),
  };
}

const PAN = { name: 'Overdeck', path: '/repos/overdeck' } as never;
const MYN = { name: 'Mind Your Now', path: '/repos/myn' } as never;

beforeEach(() => {
  process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
  process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = 'test-session-token';
  process.env.OVERDECK_DASHBOARD_CSRF_TOKEN = 'test-csrf-token';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  projectsMocks.listProjectsSync.mockReturnValue([
    { key: 'overdeck', config: PAN },
    { key: 'myn', config: MYN },
  ]);
  projectsMocks.getProjectSync.mockImplementation((key: string) =>
    key === 'overdeck' ? PAN : key === 'myn' ? MYN : null,
  );
  mergeSyncMocks.isMergeTrainEnabledForProject.mockReturnValue(true);
  mergeOrderMocks.listEligibleCandidatesByProject.mockReturnValue([]);
  mergeOrderMocks.computeMergeQueueFromCandidates.mockReturnValue(Effect.succeed([]));
  mergeBatchMocks.shipMergeBatch.mockImplementation(
    (async (issueIds: readonly string[]) => issueIds.map((issueId) => ({ issueId, ok: true as const }))) as never,
  );
});

afterEach(() => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_CSRF_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  vi.clearAllMocks();
});

describe('PAN-1696 merge-train-routes', () => {
  // ── AC1: aggregate queues, no flywheel run ─────────────────────────────────
  describe('GET /api/merge-train/queues (ac1)', () => {
    it('returns one entry per tracked project with key, effective flag, and queue', async () => {
      mergeOrderMocks.listEligibleCandidatesByProject.mockImplementation((path: string) =>
        path === '/repos/myn' ? [{ issueId: 'MIN-831', title: 'MIN-831' }] : [],
      );
      mergeOrderMocks.computeMergeQueueFromCandidates.mockImplementation((candidates: readonly { issueId: string }[]) =>
        Effect.succeed(candidates.map((c, i) => ({ issueId: c.issueId, title: c.issueId, mergeOrder: i }))),
      );

      const result = await requestMergeTrainRoute('/api/merge-train/queues');
      expect(result.status).toBe(200);
      const entries = result.body as Array<{ projectKey: string; enabled: boolean; queue: unknown[] }>;
      expect(entries.map((e) => e.projectKey)).toEqual(['overdeck', 'myn']);
      expect(entries.every((e) => e.enabled)).toBe(true);
      // The MIN issue reaches the MYN queue with no flywheel run in play at all —
      // this is the 2026-06-11 "ready MIN-831 never got a MYN generation" case.
      expect(entries.find((e) => e.projectKey === 'myn')?.queue).toHaveLength(1);
      expect(entries.find((e) => e.projectKey === 'overdeck')?.queue).toEqual([]);
    });

    it('reports a disabled project as an explicit enabled:false row with an empty queue', async () => {
      mergeSyncMocks.isMergeTrainEnabledForProject.mockImplementation(
        (config: { path: string }) => config.path !== '/repos/myn',
      );
      const entries = await getMergeTrainQueuesPayload();
      const myn = entries.find((e) => e.projectKey === 'myn');
      expect(myn).toEqual({ projectKey: 'myn', projectName: 'Mind Your Now', enabled: false, queue: [] });
      // A disabled project must never trigger git work in its repo (hazard H2).
      expect(mergeOrderMocks.listEligibleCandidatesByProject).not.toHaveBeenCalledWith('/repos/myn');
    });

    it('keeps the other projects when one project throws', async () => {
      mergeOrderMocks.listEligibleCandidatesByProject.mockImplementation((path: string) => {
        if (path === '/repos/overdeck') throw new Error('git fetch failed');
        return [];
      });
      const entries = await getMergeTrainQueuesPayload();
      expect(entries.map((e) => e.projectKey)).toEqual(['overdeck', 'myn']);
      expect(entries.find((e) => e.projectKey === 'overdeck')?.queue).toEqual([]);
    });
  });

  // ── AC2: generations + stack/promote/assemble ──────────────────────────────
  describe('GET /api/merge-train/generations (ac2)', () => {
    it('returns per-project generation chains read with each project root', async () => {
      uatTrainMocks.getUatGenerationsPayload.mockImplementation(async (root?: string) =>
        root === '/repos/myn' ? ([{ name: 'uat/min-badger-0726' }] as never) : ([] as never),
      );
      const entries = await getMergeTrainGenerationsPayload();
      expect(uatTrainMocks.getUatGenerationsPayload).toHaveBeenCalledWith('/repos/overdeck');
      expect(uatTrainMocks.getUatGenerationsPayload).toHaveBeenCalledWith('/repos/myn');
      expect(entries.find((e) => e.projectKey === 'myn')?.generations).toEqual([
        { name: 'uat/min-badger-0726' },
      ]);
    });
  });

  describe('POST stack / promote / assemble (ac2)', () => {
    it('reconstructs the uat/ prefix and returns the stack URL', async () => {
      const result = await requestMergeTrainRoute(
        '/api/merge-train/generations/pan-otter-0610/stack',
        authedInit(),
      );
      expect(result.status).toBe(200);
      expect(uatTrainMocks.postUatGenerationStackPayload).toHaveBeenCalledWith('uat/pan-otter-0610');
      expect(result.body).toMatchObject({ frontendUrl: 'https://uat-pan-otter-0610.overdeck.localhost' });
    });

    it('promotes through the post-merge lifecycle hook', async () => {
      const result = await requestMergeTrainRoute(
        '/api/merge-train/generations/pan-otter-0610/promote',
        authedInit(),
      );
      expect(result.status).toBe(200);
      const [name, fire] = uatTrainMocks.postUatGenerationPromotePayload.mock.calls[0] as [string, unknown];
      expect(name).toBe('uat/pan-otter-0610');
      expect(typeof fire).toBe('function');
    });

    it('forwards a valid shipVersion and rejects a malformed one without promoting', async () => {
      const valid = await requestMergeTrainRoute(
        '/api/merge-train/generations/pan-otter-0610/promote',
        authedInit({ shipVersion: '48.8.0' }),
      );
      expect(valid.status).toBe(200);
      expect(uatTrainMocks.postUatGenerationPromotePayload).toHaveBeenCalledWith(
        'uat/pan-otter-0610',
        expect.any(Function),
        '48.8.0',
      );

      uatTrainMocks.postUatGenerationPromotePayload.mockClear();
      const invalid = await requestMergeTrainRoute(
        '/api/merge-train/generations/pan-otter-0610/promote',
        authedInit({ shipVersion: '48.8' }),
      );
      expect(invalid).toEqual({ status: 400, body: { error: 'shipVersion must look like 48.8.0' } });
      expect(uatTrainMocks.postUatGenerationPromotePayload).not.toHaveBeenCalled();
    });

    it('ships a deferred version for a promoted batch', async () => {
      const result = await requestMergeTrainRoute(
        '/api/merge-train/generations/pan-otter-0610/ship',
        authedInit({ version: '48.8.0' }),
      );
      expect(result.status).toBe(200);
      expect(shipRecordMocks.shipPromotedBatch).toHaveBeenCalledWith({
        generationName: 'uat/pan-otter-0610',
        projectRoot: '/repos/overdeck',
        version: '48.8.0',
      });
    });

    it('maps deferred ship wrong-status and missing-config failures', async () => {
      shipRecordMocks.shipPromotedBatch.mockRejectedValueOnce(
        new shipRecordMocks.ShipPromotedBatchError('wrong-status', 'batch is ready'),
      );
      expect((await requestMergeTrainRoute(
        '/api/merge-train/generations/pan-otter-0610/ship',
        authedInit({ version: '48.8.0' }),
      )).status).toBe(409);

      shipRecordMocks.shipPromotedBatch.mockRejectedValueOnce(
        new shipRecordMocks.ShipPromotedBatchError('not-configured', 'no version_sync'),
      );
      expect((await requestMergeTrainRoute(
        '/api/merge-train/generations/pan-otter-0610/ship',
        authedInit({ version: '48.8.0' }),
      )).status).toBe(422);
    });

    it('maps a not-found promote to 404 and a conflict to 409', async () => {
      uatTrainMocks.postUatGenerationPromotePayload.mockResolvedValueOnce({
        success: false, reason: 'not-found',
      } as never);
      expect((await requestMergeTrainRoute('/api/merge-train/generations/nope/promote', authedInit())).status).toBe(404);

      uatTrainMocks.postUatGenerationPromotePayload.mockResolvedValueOnce({
        success: false, reason: 'members-ineligible',
      } as never);
      expect((await requestMergeTrainRoute('/api/merge-train/generations/nope/promote', authedInit())).status).toBe(409);
    });

    it('assembles one project when given a project key', async () => {
      const result = await postMergeTrainAssemblePayload({ project: 'myn' });
      expect(result.status).toBe(200);
      expect(uatTrainMocks.runUatTrainReconcile).toHaveBeenCalledWith({
        force: true,
        projectRoot: '/repos/myn',
      });
      expect(uatTrainMocks.runUatTrainReconcileAllProjects).not.toHaveBeenCalled();
    });

    it('assembles every enabled project when given no project key', async () => {
      const result = await postMergeTrainAssemblePayload({});
      expect(result.status).toBe(200);
      expect(uatTrainMocks.runUatTrainReconcileAllProjects).toHaveBeenCalledWith({ force: true });
      expect(uatTrainMocks.runUatTrainReconcile).not.toHaveBeenCalled();
    });

    it('400s malformed assemble JSON instead of reconciling every project', async () => {
      // A typo'd body must never become the all-projects form: that is a forced
      // git fetch/worktree sweep across every tracked repo.
      const cookie = dashboardSessionCookieHeader().split(';')[0]!;
      const result = await requestMergeTrainRoute('/api/merge-train/assemble', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${DASHBOARD_SESSION_COOKIE}=${cookie.split('=')[1]}`,
          [DASHBOARD_CSRF_HEADER]: dashboardCsrfToken(),
          origin: 'http://localhost:3011',
        },
        body: '{ project: "myn" ',
      });

      expect(result.status).toBe(400);
      expect(uatTrainMocks.runUatTrainReconcileAllProjects).not.toHaveBeenCalled();
      expect(uatTrainMocks.runUatTrainReconcile).not.toHaveBeenCalled();
    });

    it('still treats a genuinely empty body as the all-projects form', async () => {
      const result = await requestMergeTrainRoute('/api/merge-train/assemble', authedInit());
      expect(result.status).toBe(200);
      expect(uatTrainMocks.runUatTrainReconcileAllProjects).toHaveBeenCalledWith({ force: true });
    });

    it('rejects VALID non-object assemble bodies instead of reconciling everything', async () => {
      // These all parse as JSON, so the malformed-JSON guard never sees them; each
      // would previously read as "no project named" = force-reconcile every repo.
      for (const body of ['"myn"', '123', 'null', '[{"project":"myn"}]', 'true'] as const) {
        const result = await postMergeTrainAssemblePayload(JSON.parse(body));
        expect(result.status, body).toBe(400);
      }
      expect(uatTrainMocks.runUatTrainReconcileAllProjects).not.toHaveBeenCalled();
      expect(uatTrainMocks.runUatTrainReconcile).not.toHaveBeenCalled();
    });

    it('rejects VALID non-object merge-next bodies', async () => {
      for (const body of ['"myn"', '7', 'null', '[]'] as const) {
        const result = await postMergeTrainMergeNextPayload(JSON.parse(body));
        expect(result.status, body).toBe(400);
      }
      expect(mergeBatchMocks.shipMergeBatch).not.toHaveBeenCalled();
    });

    it('rejects a PRESENT but unusable project field instead of widening to all projects', async () => {
      // The review's exact cases: each is an object (so the plain-object guard
      // passes) carrying a project field that cannot name a project. Falling
      // through would turn a malformed SCOPED request into the broadest write.
      for (const body of [
        { project: 42 },
        { project: null },
        { project: '' },
        { project: '   ' },
        { project: {} },
        { project: ['myn'] },
        { project: true },
      ]) {
        const result = await postMergeTrainAssemblePayload(body);
        expect(result.status, JSON.stringify(body)).toBe(400);
      }
      // Neither reconciler may have run for any of them.
      expect(uatTrainMocks.runUatTrainReconcileAllProjects).not.toHaveBeenCalled();
      expect(uatTrainMocks.runUatTrainReconcile).not.toHaveBeenCalled();
    });

    it('rejects a PRESENT but unusable project field on merge-next too', async () => {
      for (const body of [{ n: 1, project: 42 }, { n: 1, project: null }, { n: 1, project: '' }, { n: 1, project: {} }]) {
        const result = await postMergeTrainMergeNextPayload(body);
        expect(result.status, JSON.stringify(body)).toBe(400);
      }
      expect(mergeBatchMocks.shipMergeBatch).not.toHaveBeenCalled();
    });

    it('treats ONLY an absent project field as the all-projects form', async () => {
      const result = await postMergeTrainAssemblePayload({});
      expect(result.status).toBe(200);
      expect(uatTrainMocks.runUatTrainReconcileAllProjects).toHaveBeenCalledWith({ force: true });
      expect(uatTrainMocks.runUatTrainReconcile).not.toHaveBeenCalled();
    });

    it('rejects assemble for an unknown project key with 404', async () => {
      const result = await postMergeTrainAssemblePayload({ project: 'nope' });
      expect(result.status).toBe(404);
      expect(result.body).toMatchObject({ error: expect.stringContaining('nope') });
      expect(uatTrainMocks.runUatTrainReconcile).not.toHaveBeenCalled();
    });

    it('allows internal-token callers through the unsafe mutation gate', async () => {
      const result = await requestMergeTrainRoute('/api/merge-train/generations/pan-otter-0610/stack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: 'test-token' },
        body: '{}',
      });
      expect(result).toEqual({
        status: 200,
        body: { frontendUrl: 'https://uat-pan-otter-0610.overdeck.localhost', evicted: [] },
      });
      expect(uatTrainMocks.postUatGenerationStackPayload).toHaveBeenCalledWith('uat/pan-otter-0610');
    });

    it('rejects trusted-Origin-only mutations on every POST route', async () => {
      // A trusted Origin alone is NOT enough — the same gate the legacy flywheel
      // uat-generation routes enforce (session cookie + CSRF, or internal token).
      const init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3011' },
        body: '{}',
      } satisfies RequestInit;

      for (const path of [
        '/api/merge-train/generations/pan-otter-0610/stack',
        '/api/merge-train/generations/pan-otter-0610/promote',
        '/api/merge-train/assemble',
        '/api/merge-train/merge-next',
      ]) {
        await expect(requestMergeTrainRoute(path, init), path)
          .resolves.toEqual({ status: 401, body: { error: 'unauthorized' } });
      }
      expect(uatTrainMocks.postUatGenerationStackPayload).not.toHaveBeenCalled();
      expect(mergeBatchMocks.shipMergeBatch).not.toHaveBeenCalled();
    });
  });

  // ── AC3: merge-next from a named project's ready set ───────────────────────
  describe('POST /api/merge-train/merge-next (ac3)', () => {
    it('returns 409 without merging when the queue head needs disposition', async () => {
      const gatherEligibility = vi.fn(async () => new Map([['MIN-831', {
        issueId: 'MIN-831', bucket: 'planned_backlog' as const, inPipeline: true,
        reasons: ['open issue with an unmerged branch but no PR — needs disposition'], labelDrift: null,
        lenses: { L1_openPr: false, L2_unmergedBranch: true, L3_issueOpen: true, L4_phaseLabel: 'planned' },
      }]]));

      const result = await postMergeTrainMergeNextPayload(
        { n: 1, project: 'myn' },
        { getOrderedIssueIds: async () => ['MIN-831'], gatherEligibility },
      );

      expect(result).toEqual({ status: 409, body: { error: expect.stringContaining('MIN-831 is not merge-eligible:') } });
      expect(mergeBatchMocks.shipMergeBatch).not.toHaveBeenCalled();
    });

    it('merges the first n issues of the named project ready set', async () => {
      mergeOrderMocks.listEligibleCandidatesByProject.mockImplementation((path: string) =>
        path === '/repos/myn'
          ? [{ issueId: 'MIN-831', title: 'MIN-831' }, { issueId: 'MIN-900', title: 'MIN-900' }, { issueId: 'MIN-901', title: 'MIN-901' }]
          : [],
      );
      mergeOrderMocks.computeMergeQueueFromCandidates.mockImplementation((candidates: readonly { issueId: string }[]) =>
        Effect.succeed(candidates.map((c, i) => ({ issueId: c.issueId, mergeOrder: i }))),
      );

      const result = await postMergeTrainMergeNextPayload({ n: 2, project: 'myn' });
      expect(result.status).toBe(200);
      expect(mergeOrderMocks.listEligibleCandidatesByProject).toHaveBeenCalledWith('/repos/myn');
      expect(mergeBatchMocks.shipMergeBatch).toHaveBeenCalledWith(['MIN-831', 'MIN-900'], expect.anything());
      expect(result.body).toMatchObject({ projectKey: 'myn' });
    });

    it('rejects an unknown project key with a 4xx error body', async () => {
      const result = await postMergeTrainMergeNextPayload({ n: 1, project: 'nope' });
      expect(result.status).toBe(404);
      expect(result.body).toMatchObject({ error: expect.stringContaining('nope') });
      expect(mergeBatchMocks.shipMergeBatch).not.toHaveBeenCalled();
    });

    it('rejects a missing project key with 400', async () => {
      const result = await postMergeTrainMergeNextPayload({ n: 1 });
      expect(result.status).toBe(400);
      expect(mergeBatchMocks.shipMergeBatch).not.toHaveBeenCalled();
    });

    it('rejects a non-positive n with 400 before resolving the project', async () => {
      expect((await postMergeTrainMergeNextPayload({ n: 0, project: 'myn' })).status).toBe(400);
      expect((await postMergeTrainMergeNextPayload({ project: 'myn' })).status).toBe(400);
      expect(mergeBatchMocks.shipMergeBatch).not.toHaveBeenCalled();
    });

    // Ported from the deleted postFlywheelMergeNextPayload tests (PAN-1691), so
    // the ordering + stop-at-first-failure contract survives the route removal.
    it('merges the first N in order and stops at the first failure', async () => {
      mergeBatchMocks.shipMergeBatch.mockImplementation(realShipMergeBatch as never);
      const merge = vi.fn(async (id: string) =>
        id === 'MIN-900' ? { ok: false as const, reason: 'CI red' } : { ok: true as const });

      const result = await postMergeTrainMergeNextPayload({ n: 3, project: 'myn' }, {
        getOrderedIssueIds: async () => ['MIN-831', 'MIN-900', 'MIN-901', 'MIN-902'],
        merge,
      });

      expect(result).toEqual({
        status: 200,
        body: {
          projectKey: 'myn',
          outcomes: [
            { issueId: 'MIN-831', result: 'merged' },
            { issueId: 'MIN-900', result: 'failed', reason: 'CI red' },
            { issueId: 'MIN-901', result: 'skipped' },
          ],
        },
      });
      // MIN-902 is outside the slice; MIN-901 is skipped after the failure.
      expect(merge).toHaveBeenCalledTimes(2);
    });

    it('refuses to merge for a project whose merge-train is disabled', async () => {
      mergeSyncMocks.isMergeTrainEnabledForProject.mockReturnValue(false);
      const result = await postMergeTrainMergeNextPayload({ n: 1, project: 'myn' });
      expect(result.status).toBe(409);
      expect(mergeBatchMocks.shipMergeBatch).not.toHaveBeenCalled();
    });
  });
});
