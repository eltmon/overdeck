import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const {
  createIssueMock,
  createTrackerMock,
  invalidateTrackerMock,
  loadConfigNoMigrationMock,
  loadProjectsConfigMock,
  refreshShadowStatesCacheMock,
  updateShadowStateMock,
} = vi.hoisted(() => ({
  createIssueMock: vi.fn(),
  createTrackerMock: vi.fn(),
  invalidateTrackerMock: vi.fn(),
  loadConfigNoMigrationMock: vi.fn(),
  loadProjectsConfigMock: vi.fn(),
  refreshShadowStatesCacheMock: vi.fn(),
  updateShadowStateMock: vi.fn(),
}));

vi.mock('../../../../lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/projects.js')>();
  return {
    ...actual,
    loadProjectsConfig: loadProjectsConfigMock,
  };
});

vi.mock('../../../../lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/config-yaml.js')>();
  return {
    ...actual,
    loadConfigNoMigration: loadConfigNoMigrationMock,
  };
});

vi.mock('../../../../lib/tracker/factory.js', () => ({
  createTracker: createTrackerMock,
}));

vi.mock('../../../../lib/shadow-state.js', () => ({
  updateShadowState: updateShadowStateMock,
}));

vi.mock('../../services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({
    refreshShadowStatesCache: refreshShadowStatesCacheMock,
    invalidateTracker: invalidateTrackerMock,
  }),
}));

import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { _resetNewIssueCreateRateLimitForTests, issuesRouteLayer } from '../issues.js';
import { EventStoreService } from '../../services/domain-services.js';
import type { Issue } from '../../../../lib/tracker/interface.js';

const createdIssue: Issue = {
  id: 'github-node-id-42',
  ref: '#42',
  title: 'New board issue',
  description: 'Created from the board',
  state: 'open',
  labels: [],
  url: 'https://example.test/issues/42',
  tracker: 'github',
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
};

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

async function postIssue(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const appendedEvents: Record<string, unknown>[] = [];
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: 'test-token', ...headers },
    body: JSON.stringify(body),
  }));

  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(issuesRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)
      ).pipe(Effect.provide(eventStoreLayerFor(appendedEvents))),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text), appendedEvents };
}

describe('POST /api/issues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PANOPTICON_INTERNAL_TOKEN = 'test-token';
    _resetInternalTokenCacheForTests();
    _resetNewIssueCreateRateLimitForTests();
    loadProjectsConfigMock.mockReturnValue(Effect.succeed({
      projects: {
        pan: {
          name: 'Panopticon',
          path: '/tmp/panopticon',
          tracker: 'github',
          github_repo: 'eltmon/panopticon-cli',
          issue_prefix: 'PAN',
        },
        lab: {
          name: 'GitLab project',
          path: '/tmp/gitlab-project',
          tracker: 'gitlab',
          gitlab_repo: 'group/project',
        },
        prefixedLab: {
          name: 'Prefixed GitLab project',
          path: '/tmp/gitlab-project',
          gitlab_repo: 'group/project',
          issue_prefix: 'LAB',
        },
      },
    }));
    loadConfigNoMigrationMock.mockReturnValue(Effect.succeed({
      config: {
        trackers: {
          github: { type: 'github', token_env: 'GITHUB_TOKEN' },
        },
        trackerKeys: {
          github: 'test-token',
        },
      },
    }));
    createIssueMock.mockReturnValue(Effect.succeed(createdIssue));
    createTrackerMock.mockReturnValue({ createIssue: createIssueMock });
    updateShadowStateMock.mockReturnValue(Effect.succeed({ issueId: 'PAN-42' }));
    refreshShadowStatesCacheMock.mockResolvedValue(undefined);
    invalidateTrackerMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.PANOPTICON_INTERNAL_TOKEN;
    _resetInternalTokenCacheForTests();
  });

  it('rejects unauthenticated requests before parsing config or creating issues', async () => {
    const result = await postIssue(
      { projectKey: 'pan', targetStatus: 'todo', title: 'No auth' },
      { [INTERNAL_TOKEN_HEADER]: '' },
    );

    expect(result.status).toBe(401);
    expect(loadProjectsConfigMock).not.toHaveBeenCalled();
    expect(loadConfigNoMigrationMock).not.toHaveBeenCalled();
    expect(createTrackerMock).not.toHaveBeenCalled();
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  it('creates an issue in the requested column and emits a refresh event', async () => {
    const result = await postIssue({
      projectKey: 'pan',
      targetStatus: 'todo',
      title: ' New board issue ',
      description: 'Created from the board',
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ...createdIssue,
      identifier: 'PAN-42',
    });
    expect(createTrackerMock).toHaveBeenCalledWith(
      { type: 'github', token_env: 'GITHUB_TOKEN', owner: 'eltmon', repo: 'panopticon-cli' },
      { github: 'test-token' },
    );
    expect(createIssueMock).toHaveBeenCalledWith({
      title: 'New board issue',
      description: 'Created from the board',
    });
    expect(updateShadowStateMock).toHaveBeenCalledWith('PAN-42', 'open', 'dashboard-new-issue', 'todo');
    expect(refreshShadowStatesCacheMock).toHaveBeenCalledOnce();
    expect(invalidateTrackerMock).toHaveBeenCalledWith('github');
    expect(result.appendedEvents).toContainEqual(expect.objectContaining({
      type: 'issue.statusChanged',
      payload: {
        issueId: 'PAN-42',
        status: 'Todo',
        canonicalStatus: 'todo',
        projectKey: 'pan',
        tracker: 'github',
        source: 'dashboard-new-issue',
      },
    }));
  });

  it('returns 400 when title is missing', async () => {
    const result = await postIssue({ projectKey: 'pan', targetStatus: 'todo' });

    expect(result.status).toBe(400);
    expect(result.body.details.title).toBe('title is required');
    expect(createTrackerMock).not.toHaveBeenCalled();
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  it('returns 400 when targetStatus is invalid', async () => {
    const result = await postIssue({ projectKey: 'pan', targetStatus: 'done', title: 'Nope' });

    expect(result.status).toBe(400);
    expect(result.body.details.targetStatus).toBe('targetStatus must be one of: backlog, todo');
    expect(createTrackerMock).not.toHaveBeenCalled();
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown projectKey', async () => {
    const result = await postIssue({ projectKey: 'unknown', targetStatus: 'todo', title: 'No project' });

    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Unknown projectKey: unknown');
    expect(createTrackerMock).not.toHaveBeenCalled();
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  it('returns 501 for GitLab projects without calling createIssue', async () => {
    const result = await postIssue({ projectKey: 'lab', targetStatus: 'backlog', title: 'No GitLab yet' });

    expect(result.status).toBe(501);
    expect(result.body.error).toBe('GitLab issue creation is not yet supported');
    expect(createTrackerMock).not.toHaveBeenCalled();
    expect(createIssueMock).not.toHaveBeenCalled();
    expect(updateShadowStateMock).not.toHaveBeenCalled();
  });

  it('infers GitLab before Linear when a GitLab project also has an issue prefix', async () => {
    const result = await postIssue({ projectKey: 'prefixedLab', targetStatus: 'backlog', title: 'No GitLab yet' });

    expect(result.status).toBe(501);
    expect(result.body.error).toBe('GitLab issue creation is not yet supported');
    expect(createTrackerMock).not.toHaveBeenCalled();
  });

  it('returns a generic 500 when tracker config loading fails', async () => {
    loadConfigNoMigrationMock.mockReturnValue(Effect.fail(new Error('/home/user/.panopticon/config.yaml: parse failed')));

    const result = await postIssue({ projectKey: 'pan', targetStatus: 'todo', title: 'Config failure' });

    expect(result.status).toBe(500);
    expect(result.body.error).toBe('Failed to load tracker config');
  });

  it('rate limits repeated issue creation requests', async () => {
    let result = await postIssue({ projectKey: 'pan', targetStatus: 'todo', title: 'Allowed 0' });
    expect(result.status).toBe(200);

    for (let i = 1; i < 10; i += 1) {
      result = await postIssue({ projectKey: 'pan', targetStatus: 'todo', title: `Allowed ${i}` });
      expect(result.status).toBe(200);
    }

    const blocked = await postIssue({ projectKey: 'pan', targetStatus: 'todo', title: 'Blocked' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('Too many issue creation requests. Please wait and try again.');
  });
});
