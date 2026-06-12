import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mergeTrainRouteLayer, postMergeTrainMergeNextPayload } from '../merge-train.js';
import {
  DASHBOARD_CSRF_HEADER,
  DASHBOARD_SESSION_COOKIE,
  _resetDashboardSessionTokenForTests,
  dashboardCsrfToken,
  dashboardSessionCookieHeader,
} from '../dashboard-auth.js';
import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { listProjectsSync, getProjectSync } from '../../../../lib/projects.js';
import { isMergeTrainEnabledForProject } from '../../../../lib/cloister/auto-merge-policy.js';

const mocks = vi.hoisted(() => ({
  buildIssueTitleMap: vi.fn(async () => new Map<string, string>([['PAN-1', 'Pan ready'], ['MIN-2', 'Min ready']])),
  listEligibleCandidatesByProject: vi.fn(),
  computeMergeQueueFromCandidates: vi.fn(),
  postUatGenerationStackPayload: vi.fn(async () => ({ ok: true as const, frontendUrl: 'https://uat.pan.localhost', evicted: ['uat/pan-old-0612'] })),
  postUatGenerationPromotePayload: vi.fn(async () => ({ success: true as const, generation: 'uat/pan-otter-0612', mergeSha: 'merge-sha', members: ['PAN-1'], postMergeStarted: ['PAN-1'], invalidated: [] })),
  getUatGenerationsPayload: vi.fn(async () => ([{ projectKey: 'pan', projectName: 'Panopticon', generations: [] }])),
  runUatTrainReconcile: vi.fn(async () => ({ pan: { action: 'assembled' as const, invalidated: [] } })),
  firePostMergeLifecycle: vi.fn(() => true),
  shipMergeBatch: vi.fn(async (issueIds: string[]) =>
    issueIds.map((issueId) => ({ issueId, result: 'merged' }))),
}));

vi.mock('../../services/issue-title-map.js', () => ({ buildIssueTitleMap: mocks.buildIssueTitleMap }));
vi.mock('../../services/uat-train.js', () => ({
  getUatGenerationsPayload: mocks.getUatGenerationsPayload,
  postUatGenerationStackPayload: mocks.postUatGenerationStackPayload,
  postUatGenerationPromotePayload: mocks.postUatGenerationPromotePayload,
  runUatTrainReconcile: mocks.runUatTrainReconcile,
}));
vi.mock('../specialists.js', () => ({ firePostMergeLifecycle: mocks.firePostMergeLifecycle }));
vi.mock('../../../../lib/projects.js', () => ({
  listProjectsSync: vi.fn(),
  getProjectSync: vi.fn(),
}));
vi.mock('../../../../lib/cloister/auto-merge-policy.js', () => ({
  isMergeTrainEnabledForProject: vi.fn(),
}));
vi.mock('../../../../lib/flywheel-merge-order.js', () => ({
  listEligibleCandidatesByProject: mocks.listEligibleCandidatesByProject,
  computeMergeQueueFromCandidates: mocks.computeMergeQueueFromCandidates,
  resolveMergeQueuePrUrl: vi.fn(() => undefined),
}));
vi.mock('../../../../lib/cloister/merge-batch.js', () => ({
  shipMergeBatch: mocks.shipMergeBatch,
}));

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

function authHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: 'test-token' };
}

beforeEach(() => {
  process.env.PANOPTICON_INTERNAL_TOKEN = 'test-token';
  process.env.PANOPTICON_DASHBOARD_SESSION_TOKEN = 'test-session-token';
  process.env.PANOPTICON_DASHBOARD_CSRF_TOKEN = 'test-csrf-token';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  vi.clearAllMocks();

  vi.mocked(listProjectsSync).mockReturnValue([
    { key: 'pan', config: { name: 'Panopticon', path: '/repo/pan', issue_prefix: 'PAN' } },
    { key: 'mind', config: { name: 'Mind', path: '/repo/mind', issue_prefix: 'MIN' } },
  ]);
  vi.mocked(getProjectSync).mockImplementation((key) =>
    key === 'pan'
      ? { name: 'Panopticon', path: '/repo/pan', issue_prefix: 'PAN' }
      : key === 'mind'
        ? { name: 'Mind', path: '/repo/mind', issue_prefix: 'MIN' }
        : null);
  vi.mocked(isMergeTrainEnabledForProject).mockImplementation((key) => key === 'pan');
  mocks.listEligibleCandidatesByProject.mockReturnValue(new Map([
    ['pan', { projectKey: 'pan', projectRoot: '/repo/pan', candidates: [{ issueId: 'PAN-1', title: 'Pan ready' }] }],
    ['mind', { projectKey: 'mind', projectRoot: '/repo/mind', candidates: [{ issueId: 'MIN-2', title: 'Min ready' }] }],
  ]));
  mocks.computeMergeQueueFromCandidates.mockImplementation((candidates: Array<{ issueId: string; title: string }>, _root: string) =>
    Effect.succeed(candidates.map((candidate, index) => ({
      issueId: candidate.issueId,
      title: candidate.title,
      branchName: `feature/${candidate.issueId.toLowerCase()}`,
      mergeOrder: index + 1,
      conflictsWith: [],
      batchGroup: 'batch',
    }))));
});

afterEach(() => {
  delete process.env.PANOPTICON_INTERNAL_TOKEN;
  delete process.env.PANOPTICON_DASHBOARD_SESSION_TOKEN;
  delete process.env.PANOPTICON_DASHBOARD_CSRF_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

describe('GET /api/merge-train/queues', () => {
  it('returns per-project queues and effective enabled flags without a flywheel run', async () => {
    await expect(requestMergeTrainRoute('/api/merge-train/queues')).resolves.toEqual({
      status: 200,
      body: [
        {
          projectKey: 'pan',
          projectName: 'Panopticon',
          enabled: true,
          queue: [{ issueId: 'PAN-1', title: 'Pan ready', branchName: 'feature/pan-1', mergeOrder: 1, conflictsWith: [], batchGroup: 'batch' }],
        },
        {
          projectKey: 'mind',
          projectName: 'Mind',
          enabled: false,
          queue: [{ issueId: 'MIN-2', title: 'Min ready', branchName: 'feature/min-2', mergeOrder: 1, conflictsWith: [], batchGroup: 'batch' }],
        },
      ],
    });
    expect(mocks.computeMergeQueueFromCandidates).toHaveBeenCalledWith(
      [{ issueId: 'PAN-1', title: 'Pan ready' }],
      '/repo/pan',
      expect.any(Object),
    );
    expect(mocks.computeMergeQueueFromCandidates).toHaveBeenCalledWith(
      [{ issueId: 'MIN-2', title: 'Min ready' }],
      '/repo/mind',
      expect.any(Object),
    );
  });
});

describe('GET /api/merge-train/generations', () => {
  it('returns the per-project UAT generation payload', async () => {
    await expect(requestMergeTrainRoute('/api/merge-train/generations')).resolves.toEqual({
      status: 200,
      body: [{ projectKey: 'pan', projectName: 'Panopticon', generations: [] }],
    });
  });
});

describe('UAT mutation routes', () => {
  it('rejects trusted Origin alone for stack, promote, and forced assembly mutations', async () => {
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3011' },
      body: '{}',
    } satisfies RequestInit;

    await expect(requestMergeTrainRoute('/api/merge-train/generations/pan-otter-0612/stack', init))
      .resolves.toEqual({ status: 401, body: { error: 'unauthorized' } });
    await expect(requestMergeTrainRoute('/api/merge-train/generations/pan-otter-0612/promote', init))
      .resolves.toEqual({ status: 401, body: { error: 'unauthorized' } });
    await expect(requestMergeTrainRoute('/api/merge-train/assemble', init))
      .resolves.toEqual({ status: 401, body: { error: 'unauthorized' } });

    expect(mocks.postUatGenerationStackPayload).not.toHaveBeenCalled();
    expect(mocks.postUatGenerationPromotePayload).not.toHaveBeenCalled();
    expect(mocks.runUatTrainReconcile).not.toHaveBeenCalled();
  });

  it('delegates stack and promote with reconstructed UAT generation names', async () => {
    await expect(requestMergeTrainRoute('/api/merge-train/generations/pan-otter-0612/stack', {
      method: 'POST',
      headers: authHeaders(),
      body: '{}',
    })).resolves.toEqual({
      status: 200,
      body: { frontendUrl: 'https://uat.pan.localhost', evicted: ['uat/pan-old-0612'] },
    });

    await expect(requestMergeTrainRoute('/api/merge-train/generations/pan-otter-0612/promote', {
      method: 'POST',
      headers: authHeaders(),
      body: '{}',
    })).resolves.toEqual({
      status: 200,
      body: { success: true, generation: 'uat/pan-otter-0612', mergeSha: 'merge-sha', members: ['PAN-1'], postMergeStarted: ['PAN-1'], invalidated: [] },
    });

    expect(mocks.postUatGenerationStackPayload).toHaveBeenCalledWith('uat/pan-otter-0612');
    expect(mocks.postUatGenerationPromotePayload).toHaveBeenCalledWith('uat/pan-otter-0612', mocks.firePostMergeLifecycle);
  });

  it('allows dashboard session plus CSRF callers to assemble one project', async () => {
    const cookie = dashboardSessionCookieHeader().split(';')[0]!;

    await expect(requestMergeTrainRoute('/api/merge-train/assemble', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${DASHBOARD_SESSION_COOKIE}=${cookie.split('=')[1]}`,
        [DASHBOARD_CSRF_HEADER]: dashboardCsrfToken(),
        origin: 'http://localhost:3011',
      },
      body: JSON.stringify({ project: 'pan' }),
    })).resolves.toEqual({ status: 200, body: { pan: { action: 'assembled', invalidated: [] } } });

    expect(mocks.runUatTrainReconcile).toHaveBeenCalledWith({ force: true, projectKey: 'pan' });
  });

  it('rejects unknown project assembly before reconciling', async () => {
    await expect(requestMergeTrainRoute('/api/merge-train/assemble', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ project: 'missing' }),
    })).resolves.toEqual({ status: 404, body: { error: 'Unknown project: missing' } });

    expect(mocks.runUatTrainReconcile).not.toHaveBeenCalled();
  });
});

describe('POST /api/merge-train/merge-next', () => {
  it('merges from the named project ready set in order', async () => {
    await expect(requestMergeTrainRoute('/api/merge-train/merge-next', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ n: 1, project: 'mind' }),
    })).resolves.toEqual({
      status: 200,
      body: { outcomes: [{ issueId: 'MIN-2', result: 'merged' }] },
    });

    expect(mocks.shipMergeBatch).toHaveBeenCalledWith(['MIN-2'], { merge: expect.any(Function) });
  });

  it('rejects an unknown project with a 4xx error body', async () => {
    await expect(requestMergeTrainRoute('/api/merge-train/merge-next', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ n: 1, project: 'missing' }),
    })).resolves.toEqual({
      status: 404,
      body: { error: 'Unknown project: missing' },
    });
  });

  it('keeps the payload helper injectable for merge sequencing tests', async () => {
    const merge = vi.fn(async (issueId: string) =>
      issueId === 'PAN-2' ? { ok: false as const, reason: 'CI red' } : { ok: true as const });
    const result = await postMergeTrainMergeNextPayload({ n: 3, project: 'pan' }, {
      getOrderedIssueIds: async () => ['PAN-1', 'PAN-2', 'PAN-3', 'PAN-4'],
      merge,
    });
    expect(result.status).toBe(200);
    expect(mocks.shipMergeBatch).toHaveBeenCalledWith(['PAN-1', 'PAN-2', 'PAN-3'], { merge });
  });
});
