import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const {
  mockPostStrikeMergePayload, mockGetMergeTrainBoard, mockInvalidateBoard, mockGetProjectSync,
  mockResolveProjectFromIssueSync, mockResolveGitHubIssue, mockVerifyAccessToken,
} = vi.hoisted(() => ({
  mockPostStrikeMergePayload: vi.fn(),
  mockGetMergeTrainBoard: vi.fn(),
  mockInvalidateBoard: vi.fn(),
  mockGetProjectSync: vi.fn(),
  mockResolveProjectFromIssueSync: vi.fn(),
  mockResolveGitHubIssue: vi.fn(),
  mockVerifyAccessToken: vi.fn(),
}));

vi.mock('../../services/strike-merge.js', () => ({ postStrikeMergePayload: mockPostStrikeMergePayload }));
vi.mock('../../services/merge-train-board.js', () => ({
  getMergeTrainBoard: mockGetMergeTrainBoard,
  invalidateMergeTrainBoardCache: mockInvalidateBoard,
}));
vi.mock('../../../../lib/projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/projects.js')>()),
  getProjectSync: mockGetProjectSync,
  resolveProjectFromIssueSync: mockResolveProjectFromIssueSync,
}));
vi.mock('../../../../lib/tracker-utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/tracker-utils.js')>()),
  resolveGitHubIssue: mockResolveGitHubIssue,
}));
vi.mock('../../../../lib/access-tokens.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/access-tokens.js')>();
  mockVerifyAccessToken.mockImplementation(original.verifyAccessToken);
  return { ...original, verifyAccessToken: mockVerifyAccessToken };
});
vi.mock('../../../../lib/overdeck/control-settings.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/overdeck/control-settings.js')>()),
  isFlywheelRequireUatBeforeMerge: () => false,
}));
vi.mock('../../../../lib/cloister/merge-route.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/cloister/merge-route.js')>()),
  issueTrainOn: () => true,
  issueDroppedFromBatch: () => false,
}));

import { mergeTrainLanesRouteLayer } from '../merge-train-lanes.js';
import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests } from '../dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../origin-validation.js';
import { getOverdeckHome } from '../../../../lib/paths.js';
import { IssueLifecycle } from '../../services/issue-lifecycle.js';
import { AGENT_TOKEN_SCOPES } from '../../../../lib/mcp/agent-token.js';
import { requiredScopeFor } from '../../route-scopes.js';
import { scopeSatisfies } from '../../../../lib/access-tokens.js';

async function postStrikeMerge(issueId: string, headers: Record<string, string>) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/merge-train/strikes/${issueId}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: '{}',
  }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(mergeTrainLanesRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

const AUTHED = { [INTERNAL_TOKEN_HEADER]: 'test-token' };

async function getBoard(query = '') {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/merge-train/board${query}`, { headers: AUTHED }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(mergeTrainLanesRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

function resetAuth() {
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetTrustedOriginsForTests();
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
  delete process.env.OVERDECK_TRUSTED_ORIGINS;
  // The token file wins over env (PAN-4628); delete any file a sibling test left.
  rmSync(join(getOverdeckHome(), 'internal-token'), { force: true });
  resetAuth();
});

afterEach(() => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_CSRF_TOKEN;
  delete process.env.OVERDECK_TRUSTED_ORIGINS;
  resetAuth();
});

/** The label calls the policy route made, in order. */
const labelCalls: string[] = [];
const lifecycleLayer = Layer.succeed(IssueLifecycle, {
  transitionTo: () => Effect.void,
  addLabel: (issueId: string, label: string) => Effect.sync(() => { labelCalls.push(`add ${issueId} ${label}`); }),
  removeLabel: (issueId: string, label: string) => Effect.sync(() => { labelCalls.push(`remove ${issueId} ${label}`); }),
  close: () => Effect.void,
});

async function postPolicy(issueId: string, body: unknown, headers: Record<string, string> = AUTHED) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/merge-train/policy/${issueId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(mergeTrainLanesRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)).pipe(Effect.provide(lifecycleLayer)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

/** PAN-4753 WI-8: the per-issue merge policy write. */
describe('POST /api/merge-train/policy/:issueId', () => {
  beforeEach(() => {
    labelCalls.length = 0;
    mockResolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectPath: '/repo' });
    mockGetProjectSync.mockReturnValue({ name: 'overdeck', path: '/repo', github_repo: 'eltmon/overdeck' });
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'overdeck', number: 9 });
  });

  it.each([
    ['auto', ['remove PAN-9 hold-for-uat', 'add PAN-9 auto-merge'], 'auto'],
    ['hold', ['remove PAN-9 auto-merge', 'add PAN-9 hold-for-uat'], 'hold'],
    ['default', ['remove PAN-9 auto-merge', 'remove PAN-9 hold-for-uat'], 'auto'],
  ] as const)('policy %s writes the matching label calls', async (policy, calls, effectivePolicy) => {
    const res = await postPolicy('pan-9', { policy });
    expect(res.status).toBe(200);
    expect(labelCalls).toEqual(calls);
    // The train is on and the issue is normal priority, so every policy routes to the batch.
    expect(res.body).toMatchObject({ issueId: 'PAN-9', policy, effectivePolicy, route: 'batch' });
    expect(mockInvalidateBoard).toHaveBeenCalled();
  });

  it('a project default of hold makes `default` effectively Hold', async () => {
    mockGetProjectSync.mockReturnValue({ name: 'overdeck', path: '/repo', github_repo: 'eltmon/overdeck', auto_merge_default: 'hold' });
    const res = await postPolicy('PAN-9', { policy: 'default' });
    expect(res.body).toMatchObject({ effectivePolicy: 'hold', route: 'batch' });
  });

  it('returns 501 for a Linear project and writes no label', async () => {
    mockGetProjectSync.mockReturnValue({ name: 'myn', path: '/myn', tracker: 'linear', github_repo: 'eltmon/myn' });
    const res = await postPolicy('MIN-9', { policy: 'auto' });
    expect(res.status).toBe(501);
    expect(String(res.body['error'])).toContain('linear');
    expect(labelCalls).toEqual([]);
  });

  it('returns 501 when the id does not resolve to a GitHub issue', async () => {
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: false });
    const res = await postPolicy('PAN-9', { policy: 'hold' });
    expect(res.status).toBe(501);
    expect(labelCalls).toEqual([]);
  });

  it('returns 404 when no project owns the issue', async () => {
    mockResolveProjectFromIssueSync.mockReturnValue(null);
    const res = await postPolicy('PAN-9', { policy: 'hold' });
    expect(res.status).toBe(404);
    expect(labelCalls).toEqual([]);
  });

  it('returns 400 for an unknown policy and for a bad issue id', async () => {
    expect((await postPolicy('PAN-9', { policy: 'maybe' })).status).toBe(400);
    expect((await postPolicy('not-an-issue', { policy: 'auto' })).status).toBe(400);
    expect(labelCalls).toEqual([]);
  });

  it('refuses a cookie request without a CSRF token', async () => {
    process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = 'session-token';
    process.env.OVERDECK_DASHBOARD_CSRF_TOKEN = 'csrf-token';
    resetAuth();
    const res = await postPolicy('PAN-9', { policy: 'auto' }, { Cookie: 'overdeck_session=session-token' });
    expect(res.status).toBe(403);
    expect(labelCalls).toEqual([]);
  });

  // The grant labels are operator-only: the agent gh shim refuses them, and so does this route.
  it('needs admin, which no agent token role holds', () => {
    expect(requiredScopeFor('POST', '/api/merge-train/policy/PAN-9')).toBe('admin');
    for (const scopes of Object.values(AGENT_TOKEN_SCOPES)) expect(scopeSatisfies(scopes, 'admin')).toBe(false);
  });

  it.each(Object.entries(AGENT_TOKEN_SCOPES))('refuses a %s agent token with 403', async (role, scopes) => {
    mockVerifyAccessToken.mockReturnValueOnce({
      ok: true,
      record: { id: 'tok-1', kind: 'token', scopes: [...scopes], agentId: 'agent-pan-9', agentKind: role === 'conversation' ? 'conversation' : 'agent', role },
    });
    const res = await postPolicy('PAN-9', { policy: 'auto' }, { Authorization: 'Bearer odk_agent' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'insufficient_scope', missingScope: 'admin' });
    expect(labelCalls).toEqual([]);
  });
});

/** PAN-4750: the operator's strike Merge button. */
describe('POST /api/merge-train/strikes/:issueId/merge', () => {
  it('refuses a request with no dashboard credential', async () => {
    const res = await postStrikeMerge('PAN-9', {});
    expect(res.status).toBe(401);
    expect(mockPostStrikeMergePayload).not.toHaveBeenCalled();
  });

  it('refuses a cross-site request without a CSRF token', async () => {
    process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = 'session-token';
    process.env.OVERDECK_DASHBOARD_CSRF_TOKEN = 'csrf-token';
    resetAuth();
    const res = await postStrikeMerge('PAN-9', { Cookie: 'overdeck_session=session-token' });
    expect(res.status).toBe(403);
    expect(mockPostStrikeMergePayload).not.toHaveBeenCalled();
  });

  it('returns 400 on a bad issue id', async () => {
    const res = await postStrikeMerge('not-an-issue', AUTHED);
    expect(res).toEqual({ status: 400, body: { error: 'Invalid issue ID' } });
    expect(mockPostStrikeMergePayload).not.toHaveBeenCalled();
  });

  it('merges the upper-cased issue and returns the payload status', async () => {
    mockPostStrikeMergePayload.mockResolvedValue({ status: 200, body: { success: true, outcome: 'merging' } });
    const res = await postStrikeMerge('pan-9', AUTHED);
    expect(res).toEqual({ status: 200, body: { success: true, outcome: 'merging' } });
    expect(mockPostStrikeMergePayload).toHaveBeenCalledWith('PAN-9');
  });

  it('passes a refusal status through', async () => {
    mockPostStrikeMergePayload.mockResolvedValue({ status: 404, body: { success: false, error: 'No strike workspace for PAN-9' } });
    const res = await postStrikeMerge('PAN-9', AUTHED);
    expect(res.status).toBe(404);
  });
});

/** PAN-4753 WI-7: the merge-train board read. */
describe('GET /api/merge-train/board', () => {
  const board = { masterEnabled: true, projects: [{ projectKey: 'overdeck', cars: [], strikes: [], batches: [], recent: [] }] };

  it('returns the board for every project', async () => {
    mockGetMergeTrainBoard.mockResolvedValue(board);
    const res = await getBoard();
    expect(res).toEqual({ status: 200, body: board });
    expect(mockGetMergeTrainBoard).toHaveBeenCalledWith({ projectKey: undefined });
  });

  it('filters to one known project', async () => {
    mockGetProjectSync.mockReturnValue({ name: 'overdeck', path: '/repo' });
    mockGetMergeTrainBoard.mockResolvedValue(board);
    const res = await getBoard('?project=overdeck');
    expect(res.status).toBe(200);
    expect(mockGetMergeTrainBoard).toHaveBeenCalledWith({ projectKey: 'overdeck' });
  });

  it('returns 404 for an unknown project', async () => {
    mockGetProjectSync.mockReturnValue(null);
    const res = await getBoard('?project=nope');
    expect(res).toEqual({ status: 404, body: { error: 'Unknown project: nope' } });
    expect(mockGetMergeTrainBoard).not.toHaveBeenCalled();
  });
});
