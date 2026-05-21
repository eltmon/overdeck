import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const { closeOutMock, resolveProjectFromIssueMock, resolveGitHubIssueMock, issueDataServiceMock } = vi.hoisted(() => ({
  closeOutMock: vi.fn(),
  resolveProjectFromIssueMock: vi.fn(),
  resolveGitHubIssueMock: vi.fn(),
  issueDataServiceMock: {
    getIssueSource: vi.fn(),
    getIssues: vi.fn(),
    patchIssue: vi.fn(),
    invalidateTracker: vi.fn(),
  },
}));

vi.mock('../../../../lib/lifecycle/index.js', () => ({
  closeOut: closeOutMock,
}));

vi.mock('../../../../lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/projects.js')>();
  return {
    ...actual,
    resolveProjectFromIssue: resolveProjectFromIssueMock,
  };
});

vi.mock('../../../../lib/tracker-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/tracker-utils.js')>();
  return {
    ...actual,
    resolveGitHubIssue: resolveGitHubIssueMock,
  };
});

vi.mock('../../services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => issueDataServiceMock,
}));

import { issuesRouteLayer } from '../issues.js';
import { EventStoreService } from '../../services/domain-services.js';
import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { DASHBOARD_CSRF_HEADER, DASHBOARD_SESSION_COOKIE, _resetDashboardSessionTokenForTests, dashboardCsrfToken } from '../dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../origin-validation.js';

function eventStoreLayerFor(appendedEvents: Record<string, unknown>[]) {
  return Layer.succeed(EventStoreService, {
    append: (event: Record<string, unknown>) => Effect.sync(() => {
      appendedEvents.push(event);
      return appendedEvents.length;
    }),
    appendAsync: (event: Record<string, unknown>) => Effect.sync(() => {
      appendedEvents.push(event);
      return appendedEvents.length;
    }),
    readFrom: () => Effect.succeed([]),
    queryByType: () => Effect.succeed([]),
    getLatestSequence: Effect.succeed(0),
    streamEvents: Stream.empty,
  });
}

async function postCloseOut(issueId: string, headers: Record<string, string> = {}) {
  const appendedEvents: Record<string, unknown>[] = [];
  const eventStoreLayer = eventStoreLayerFor(appendedEvents);

  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/issues/${issueId}/close-out`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: 'test-token', ...headers },
  }));

  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(issuesRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)
      ).pipe(Effect.provide(eventStoreLayer)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text), appendedEvents };
}

async function postBulkCloseOut(headers: Record<string, string> = {}) {
  const appendedEvents: Record<string, unknown>[] = [];
  const eventStoreLayer = eventStoreLayerFor(appendedEvents);
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/issues/bulk-close-out', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ issueIds: ['PAN-1190'] }),
  }));

  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(issuesRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)
      ).pipe(Effect.provide(eventStoreLayer)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text), appendedEvents };
}

afterEach(() => {
  delete process.env.PANOPTICON_INTERNAL_TOKEN;
  delete process.env.PANOPTICON_DASHBOARD_SESSION_TOKEN;
  delete process.env.PANOPTICON_DASHBOARD_CSRF_TOKEN;
  delete process.env.PANOPTICON_TRUSTED_ORIGINS;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetTrustedOriginsForTests();
});

describe('POST /api/issues/:id/close-out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PANOPTICON_INTERNAL_TOKEN = 'test-token';
    process.env.PANOPTICON_DASHBOARD_SESSION_TOKEN = 'test-browser-session-token';
    process.env.PANOPTICON_DASHBOARD_CSRF_TOKEN = 'test-csrf-token';
    delete process.env.PANOPTICON_TRUSTED_ORIGINS;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
    resolveProjectFromIssueMock.mockReturnValue({
      projectName: 'panopticon',
      projectPath: '/tmp/panopticon',
    });
    resolveGitHubIssueMock.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'panopticon-cli',
      number: 1190,
    });
    issueDataServiceMock.getIssueSource.mockReturnValue('github');
    issueDataServiceMock.getIssues.mockReturnValue([
      {
        identifier: 'PAN-1190',
        status: 'Verifying on Main',
        state: 'verifying_on_main',
        canonicalStatus: 'verifying_on_main',
        mergeStatus: 'merged',
        labels: ['bug', 'verifying-on-main', 'needs-close-out'],
      },
    ]);
    issueDataServiceMock.invalidateTracker.mockResolvedValue(undefined);
    // PAN-1249: closeOut returns Effect<WorkflowResult>, not Promise.
    closeOutMock.mockReturnValue(Effect.succeed({
      workflow: 'close-out',
      issueId: 'PAN-1190',
      success: true,
      steps: [
        { step: 'close-out:verify-merged', success: true, details: ['Branch already cleaned up (squash-merged)'] },
        { step: 'close-out:vbrief-completed', success: true },
        { step: 'close-issue:github', success: true },
      ],
      duration: 12,
    }));
  });

  it('returns a successful WorkflowResult and marks a verifying-on-main issue done', async () => {
    const result = await postCloseOut('PAN-1190');

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      workflow: 'close-out',
      issueId: 'PAN-1190',
      success: true,
    });
    expect(closeOutMock).toHaveBeenCalledWith({
      issueId: 'PAN-1190',
      projectName: 'panopticon',
      projectPath: '/tmp/panopticon',
      github: { owner: 'eltmon', repo: 'panopticon-cli', number: 1190 },
    });
    expect(issueDataServiceMock.patchIssue).toHaveBeenCalledWith('PAN-1190', {
      status: 'Done',
      state: 'done',
      canonicalStatus: 'done',
      targetCanonicalState: 'done',
      mergeStatus: undefined,
      labels: ['bug', 'closed-out'],
    });
    expect(result.appendedEvents).toEqual([
      expect.objectContaining({
        type: 'issue.statusChanged',
        payload: {
          issueId: 'PAN-1190',
          status: 'Done',
          state: 'done',
          canonicalStatus: 'done',
          labels: ['bug', 'closed-out'],
        },
      }),
    ]);
  });

  it('returns a successful no-op when close-out is repeated', async () => {
    const cachedIssue = {
      identifier: 'PAN-1190',
      status: 'Verifying on Main',
      state: 'verifying_on_main',
      canonicalStatus: 'verifying_on_main',
      mergeStatus: 'merged',
      labels: ['bug', 'verifying-on-main', 'needs-close-out'],
    };
    issueDataServiceMock.getIssues.mockReturnValue([cachedIssue]);
    issueDataServiceMock.patchIssue.mockImplementation((_id: string, patch: Record<string, unknown>) => {
      Object.assign(cachedIssue, patch);
    });

    const first = await postCloseOut('PAN-1190');
    const second = await postCloseOut('PAN-1190');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      workflow: 'close-out',
      issueId: 'PAN-1190',
      success: true,
      steps: [{ step: 'close-out:idempotent', success: true, skipped: true }],
    });
    expect(closeOutMock).toHaveBeenCalledOnce();
  });

  it('allows cookie-authenticated dashboard requests with exact trusted origin and CSRF token', async () => {
    const result = await postCloseOut('PAN-1190', {
      [INTERNAL_TOKEN_HEADER]: '',
      cookie: `${DASHBOARD_SESSION_COOKIE}=test-browser-session-token`,
      origin: 'http://localhost:3011',
      [DASHBOARD_CSRF_HEADER]: dashboardCsrfToken(),
    });

    expect(result.status).toBe(200);
    expect(closeOutMock).toHaveBeenCalledOnce();
  });

  it('rejects cookie-authenticated close-out requests from same-site workspace origins', async () => {
    const result = await postCloseOut('PAN-1190', {
      [INTERNAL_TOKEN_HEADER]: '',
      cookie: `${DASHBOARD_SESSION_COOKIE}=test-browser-session-token`,
      origin: 'http://api-feature-pan-1190.pan.localhost:3011',
      [DASHBOARD_CSRF_HEADER]: dashboardCsrfToken(),
    });

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'Invalid origin' });
    expect(closeOutMock).not.toHaveBeenCalled();
  });

  it('rejects cookie-authenticated close-out requests without a CSRF token', async () => {
    const result = await postCloseOut('PAN-1190', {
      [INTERNAL_TOKEN_HEADER]: '',
      cookie: `${DASHBOARD_SESSION_COOKIE}=test-browser-session-token`,
      origin: 'http://localhost:3011',
    });

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'Invalid CSRF token' });
    expect(closeOutMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/issues/bulk-close-out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PANOPTICON_INTERNAL_TOKEN = 'test-token';
    process.env.PANOPTICON_DASHBOARD_SESSION_TOKEN = 'test-browser-session-token';
    process.env.PANOPTICON_DASHBOARD_CSRF_TOKEN = 'test-csrf-token';
    delete process.env.PANOPTICON_TRUSTED_ORIGINS;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
  });

  it('rejects requests without dashboard authorization', async () => {
    const result = await postBulkCloseOut();

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: 'unauthorized' });
    expect(closeOutMock).not.toHaveBeenCalled();
  });

  it('rejects cookie-authenticated bulk close-out from untrusted same-site origins', async () => {
    const result = await postBulkCloseOut({
      cookie: `${DASHBOARD_SESSION_COOKIE}=test-browser-session-token`,
      origin: 'http://feature-pan-1190.pan.localhost:3011',
      [DASHBOARD_CSRF_HEADER]: dashboardCsrfToken(),
    });

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'Invalid origin' });
    expect(closeOutMock).not.toHaveBeenCalled();
  });
});
