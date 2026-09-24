import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

// PAN-3917 W6: the record plane is deleted by W3; these route trees still reach
// it transitively (config-yaml → tier-table → record, workspaces/resolver →
// overdeck/infra → record). Stub the chain entry so the route under test loads.

const {
  issueDataServiceMock,
  mockTransitionTo,
  mockRemoveLabel,
  mockLinearGetIssue,
  mockFindProjectByTeam,
  mockResolveGitHubIssue,
  mockResetPostMergeState,
  mockFetchIssuePullRequest,
  mockExecAsync,
} = vi.hoisted(() => ({
  issueDataServiceMock: {
    getIssueSource: vi.fn(),
    getIssues: vi.fn(),
    patchIssue: vi.fn(),
    invalidateTracker: vi.fn(),
  },
  mockTransitionTo: vi.fn(),
  mockRemoveLabel: vi.fn(),
  mockLinearGetIssue: vi.fn(),
  mockFindProjectByTeam: vi.fn(),
  mockResolveGitHubIssue: vi.fn(),
  mockResetPostMergeState: vi.fn(),
  mockFetchIssuePullRequest: vi.fn(),
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '[]', stderr: '' }),
}));

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>();
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

vi.mock('../../services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => issueDataServiceMock,
}));


vi.mock('../../../../lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/projects.js')>();
  return {
    ...actual,
    findProjectByTeam: mockFindProjectByTeam,
  };
});

vi.mock('../../../../lib/tracker-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/tracker-utils.js')>();
  return {
    ...actual,
    resolveGitHubIssueSync: mockResolveGitHubIssue,
  };
});

vi.mock('../../../../lib/cloister/merge-agent.js', () => ({
  resetPostMergeState: mockResetPostMergeState,
}));

// PAN-3917: "already merged" is the pull request's own state, not a stored copy.
vi.mock('../../../../lib/overdeck/pull-requests.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/overdeck/pull-requests.js')>();
  return { ...actual, fetchIssuePullRequest: mockFetchIssuePullRequest };
});

import { issuesRouteLayer } from '../issues.js';
import { EventStoreService } from '../../services/domain-services.js';
import { IssueLifecycle } from '../../services/issue-lifecycle.js';
import { LinearClient } from '../../services/linear-client.js';
import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests } from '../dashboard-auth.js';
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

function routeServicesLayer(appendedEvents: Record<string, unknown>[]) {
  return Layer.mergeAll(
    eventStoreLayerFor(appendedEvents),
    Layer.succeed(IssueLifecycle, {
      transitionTo: mockTransitionTo,
      addLabel: vi.fn(),
      removeLabel: mockRemoveLabel,
      close: vi.fn(),
    }),
    Layer.succeed(LinearClient, {
      getIssue: mockLinearGetIssue,
      getTeamStates: vi.fn(),
      updateState: vi.fn(),
      addComment: vi.fn(),
      findOrCreateLabel: vi.fn(),
      addLabel: vi.fn(),
      removeLabel: vi.fn(),
    }),
  );
}

async function postReopen(issueId: string) {
  const appendedEvents: Record<string, unknown>[] = [];
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/issues/${issueId}/reopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: 'test-token' },
    body: JSON.stringify({ reason: 'retry close-out' }),
  }));

  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(issuesRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)
      ).pipe(Effect.provide(routeServicesLayer(appendedEvents))),
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
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetTrustedOriginsForTests();
});

describe('POST /api/issues/:id/reopen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
    delete process.env.OVERDECK_TRUSTED_ORIGINS;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();

    issueDataServiceMock.getIssueSource.mockReturnValue('github');
    issueDataServiceMock.getIssues.mockReturnValue([{ identifier: 'PAN-1190' }]);
    mockFetchIssuePullRequest.mockResolvedValue({ pr: { mergedAt: '2026-09-17T00:00:00.000Z' } });
    issueDataServiceMock.invalidateTracker.mockResolvedValue(undefined);
    mockTransitionTo.mockReturnValue(Effect.void);
    mockRemoveLabel.mockReturnValue(Effect.void);
    mockLinearGetIssue.mockReturnValue(Effect.succeed(null));
    mockFindProjectByTeam.mockReturnValue(null);
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      prefix: 'PAN',
      number: 1190,
    });
    mockExecAsync.mockResolvedValue({ stdout: '[]', stderr: '' });
  });

  it('reopens merged issues back to verifying_on_main and resets post-merge state', async () => {
    const result = await postReopen('PAN-1190');

    expect(result.status).toBe(200);
    expect(result.body.newState).toBe('Verifying on Main');
    expect(mockTransitionTo).toHaveBeenCalledWith('PAN-1190', 'verifying_on_main');
    expect(mockRemoveLabel).not.toHaveBeenCalledWith('PAN-1190', 'done');
    expect(mockRemoveLabel).not.toHaveBeenCalledWith('PAN-1190', 'needs-close-out');
    expect(mockRemoveLabel).not.toHaveBeenCalledWith('PAN-1190', 'merged');
    expect(mockResetPostMergeState).toHaveBeenCalledWith('PAN-1190');
    expect(issueDataServiceMock.patchIssue).toHaveBeenCalledWith('PAN-1190', {
      status: 'Verifying on Main',
      canonicalStatus: 'verifying_on_main',
    });
    expect(result.appendedEvents).toContainEqual(expect.objectContaining({
      type: 'issue.statusChanged',
      payload: {
        issueId: 'PAN-1190',
        status: 'Verifying on Main',
        canonicalStatus: 'verifying_on_main',
      },
    }));
  });
});
