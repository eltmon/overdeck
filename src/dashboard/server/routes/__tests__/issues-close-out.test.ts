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
    resolveProjectFromIssueSync: resolveProjectFromIssueMock,
  };
});

vi.mock('../../../../lib/tracker-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/tracker-utils.js')>();
  return {
    ...actual,
    resolveGitHubIssue: resolveGitHubIssueMock,
    resolveGitHubIssueSync: resolveGitHubIssueMock,
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

const originalApiPort = process.env.API_PORT;
const originalPort = process.env.PORT;
const originalDashboardUrl = process.env.DASHBOARD_URL;

function restoreEnv(name: 'API_PORT' | 'PORT' | 'DASHBOARD_URL', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function pinDefaultDashboardOrigin(): void {
  process.env.API_PORT = '3011';
  delete process.env.PORT;
  delete process.env.DASHBOARD_URL;
}

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

async function postCloseOut(issueId: string, headers: Record<string, string> = {}, body?: Record<string, unknown>) {
  const appendedEvents: Record<string, unknown>[] = [];
  const eventStoreLayer = eventStoreLayerFor(appendedEvents);

  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/issues/${issueId}/close-out`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: 'test-token', ...headers },
    body: body ? JSON.stringify(body) : undefined,
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
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_CSRF_TOKEN;
  delete process.env.OVERDECK_TRUSTED_ORIGINS;
  restoreEnv('API_PORT', originalApiPort);
  restoreEnv('PORT', originalPort);
  restoreEnv('DASHBOARD_URL', originalDashboardUrl);
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetTrustedOriginsForTests();
});

describe('POST /api/issues/:id/close-out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
    process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = 'test-browser-session-token';
    process.env.OVERDECK_DASHBOARD_CSRF_TOKEN = 'test-csrf-token';
    delete process.env.OVERDECK_TRUSTED_ORIGINS;
    pinDefaultDashboardOrigin();
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
    resolveProjectFromIssueMock.mockReturnValue({
      projectName: 'overdeck',
      projectPath: '/tmp/overdeck',
    });
    resolveGitHubIssueMock.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
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
      projectName: 'overdeck',
      projectPath: '/tmp/overdeck',
      github: { owner: 'eltmon', repo: 'overdeck', number: 1190 },
    }, { dodAcceptedRows: [], dodAcceptedBy: 'dashboard-operator' });
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

  it('passes accepted rows and attribution into closeOut', async () => {
    const result = await postCloseOut('PAN-1190', {}, { acceptedRows: ['deploy'], acceptedBy: 'operator' });
    expect(result.status).toBe(200);
    expect(closeOutMock).toHaveBeenCalledWith(expect.anything(), {
      dodAcceptedRows: ['deploy'],
      dodAcceptedBy: 'operator',
    });
  });

  it('rejects invalid accepted row ids with the valid list', async () => {
    const result = await postCloseOut('PAN-1190', {}, { acceptedRows: ['teardown'] });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('Invalid acceptedRows');
    expect(result.body.validRows).toContain('deploy');
    expect(closeOutMock).not.toHaveBeenCalled();
  });

  it('returns gate rows and misses in the 422 payload', async () => {
    closeOutMock.mockReturnValueOnce(Effect.succeed({
      workflow: 'close-out', issueId: 'PAN-1190', success: false, duration: 2,
      steps: [{ step: 'close-out:dod-gate', success: false, skipped: false, error: 'blocked' }],
      dodGate: {
        passed: false, misses: ['deploy'], accepted: [],
        rows: [{ id: 'deploy', num: 7, title: 'Deployed', expected: 'live build includes merge', observed: 'server stale', status: 'miss' }],
      },
    }));
    const result = await postCloseOut('PAN-1190');
    expect(result.status).toBe(422);
    expect(result.body.dodGate).toMatchObject({ misses: ['deploy'] });
    expect(result.body.dodGate.rows[0]).toMatchObject({ id: 'deploy', observed: 'server stale', status: 'miss' });
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
      origin: 'http://api-feature-pan-1190.overdeck.localhost:3011',
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
    process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
    process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = 'test-browser-session-token';
    process.env.OVERDECK_DASHBOARD_CSRF_TOKEN = 'test-csrf-token';
    delete process.env.OVERDECK_TRUSTED_ORIGINS;
    pinDefaultDashboardOrigin();
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
      origin: 'http://feature-pan-1190.overdeck.localhost:3011',
      [DASHBOARD_CSRF_HEADER]: dashboardCsrfToken(),
    });

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'Invalid origin' });
    expect(closeOutMock).not.toHaveBeenCalled();
  });
});
