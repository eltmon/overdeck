import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const {
  issueDataServiceMock,
  mockResolveProjectFromIssue,
  mockResolveGitHubIssue,
  mockListSessionNames,
  mockSaveAgentStateSync,
  mockSpawnPlanningSession,
  mockTransitionTo,
  mockAddLabel,
  mockGitHubGetIssue,
  mockGitHubGetComments,
} = vi.hoisted(() => ({
  issueDataServiceMock: {
    getIssueSource: vi.fn(),
    getIssues: vi.fn(),
    patchIssue: vi.fn(),
    invalidateTracker: vi.fn(),
  },
  mockResolveProjectFromIssue: vi.fn(),
  mockResolveGitHubIssue: vi.fn(),
  mockListSessionNames: vi.fn(),
  mockSaveAgentStateSync: vi.fn(),
  mockSpawnPlanningSession: vi.fn(),
  mockTransitionTo: vi.fn(),
  mockAddLabel: vi.fn(),
  mockGitHubGetIssue: vi.fn(),
  mockGitHubGetComments: vi.fn(),
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
    promisify: () => vi.fn().mockResolvedValue({ stdout: '[]', stderr: '' }),
  };
});

vi.mock('../../../../lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/projects.js')>();
  return {
    ...actual,
    resolveProjectFromIssueSync: mockResolveProjectFromIssue,
  };
});

vi.mock('../../../../lib/tracker-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/tracker-utils.js')>();
  return {
    ...actual,
    resolveGitHubIssueSync: mockResolveGitHubIssue,
    resolveTrackerTypeSync: () => 'github',
  };
});

vi.mock('../../services/tracker-config.js', () => ({
  getGitHubConfig: () => ({
    token: 'test-token',
    repos: [{ owner: 'eltmon', repo: 'overdeck', prefix: 'PAN' }],
  }),
  getRallyConfig: () => null,
}));

vi.mock('../../services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => issueDataServiceMock,
}));

vi.mock('../../../../lib/tmux.js', () => ({
  listSessionNames: mockListSessionNames,
  killSession: vi.fn(() => Effect.void),
  sessionExists: vi.fn(() => Effect.succeed(false)),
}));

vi.mock('../../../../lib/agents.js', () => ({
  getAgentState: vi.fn(),
  getAgentStateSync: vi.fn(),
  saveAgentStateSync: mockSaveAgentStateSync,
  getProviderAuthMode: vi.fn(() => Promise.resolve('api')),
  normalizeAgentId: vi.fn((id: string) => id),
}));

vi.mock('../../../../lib/activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../../../../lib/planning/spawn-planning-session.js', () => ({
  resolveAutoSpawnOnFinalize: vi.fn(() => 'start'),
  spawnPlanningSession: mockSpawnPlanningSession,
}));

import { issuesRouteLayer } from '../issues.js';
import { EventStoreService } from '../../services/domain-services.js';
import { IssueLifecycle } from '../../services/issue-lifecycle.js';
import { LinearClient } from '../../services/linear-client.js';
import { GitHubClient } from '../../services/github-client.js';
import { RallyClient } from '../../services/rally-client.js';
import { IssueNotFound } from '../../services/typed-errors.js';

let projectPath: string;
let originalHome: string | undefined;
let originalOverdeckHome: string | undefined;

function eventStoreLayer(appendedEvents: Record<string, unknown>[]) {
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
    eventStoreLayer(appendedEvents),
    Layer.succeed(IssueLifecycle, {
      transitionTo: mockTransitionTo,
      addLabel: mockAddLabel,
      removeLabel: vi.fn(),
      close: vi.fn(),
    }),
    Layer.succeed(LinearClient, {
      getIssue: vi.fn(),
      getTeamStates: vi.fn(),
      updateState: vi.fn(),
      addComment: vi.fn(),
      findOrCreateLabel: vi.fn(),
      addLabel: vi.fn(),
      removeLabel: vi.fn(),
    }),
    Layer.succeed(GitHubClient, {
      getIssue: mockGitHubGetIssue,
      getComments: mockGitHubGetComments,
      closeIssue: vi.fn(),
      reopenIssue: vi.fn(),
      addLabel: vi.fn(),
      removeLabel: vi.fn(),
      ensureLabel: vi.fn(),
      addComment: vi.fn(),
    }),
    Layer.succeed(RallyClient, {
      getIssue: vi.fn(),
      getChildIssues: vi.fn(),
      getTeamStates: vi.fn(),
      updateState: vi.fn(),
      addComment: vi.fn(),
      addLabel: vi.fn(),
      removeLabel: vi.fn(),
    }),
  );
}

async function postStartPlanning(issueId: string) {
  const appendedEvents: Record<string, unknown>[] = [];
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/issues/${issueId}/start-planning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auto: true, autoStart: true }),
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

describe('POST /api/issues/:id/start-planning GitHub hydration', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    projectPath = await mkdtemp(join(tmpdir(), 'pan-start-planning-'));
    originalHome = process.env.HOME;
    originalOverdeckHome = process.env.OVERDECK_HOME;
    process.env.HOME = projectPath;
    process.env.OVERDECK_HOME = join(projectPath, '.overdeck');
    mockResolveProjectFromIssue.mockReturnValue({
      projectKey: 'overdeck',
      projectName: 'Overdeck',
      projectPath,
      linearTeam: 'PAN',
    });
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      prefix: 'PAN',
      number: 1993,
    });
    mockListSessionNames.mockReturnValue(Effect.succeed([]));
    mockGitHubGetComments.mockReturnValue(Effect.succeed([]));
    mockTransitionTo.mockReturnValue(Effect.void);
    mockAddLabel.mockReturnValue(Effect.void);
    mockSpawnPlanningSession.mockResolvedValue({ success: true, sessionName: 'planning-pan-1993' });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }
    if (projectPath) await rm(projectPath, { recursive: true, force: true });
  });

  it('retries transient GitHub 404s before starting planning', async () => {
    mockGitHubGetIssue
      .mockReturnValueOnce(Effect.fail(new IssueNotFound({ id: 'PAN-1993' })))
      .mockReturnValueOnce(Effect.fail(new IssueNotFound({ id: 'PAN-1993' })))
      .mockReturnValueOnce(Effect.succeed({
        number: 1993,
        title: 'Planning race',
        body: 'Retry propagation lag.',
        state: 'open',
        labels: [],
        htmlUrl: 'https://github.com/eltmon/overdeck/issues/1993',
      }));

    const resultPromise = postStartPlanning('PAN-1993');
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);
    const result = await resultPromise;

    expect(result.status).toBe(200);
    expect(mockGitHubGetIssue).toHaveBeenCalledTimes(3);
    expect(mockGitHubGetIssue).toHaveBeenNthCalledWith(1, 'eltmon', 'overdeck', 1993);
    expect(mockGitHubGetIssue).toHaveBeenNthCalledWith(3, 'eltmon', 'overdeck', 1993);
    expect(mockSaveAgentStateSync).toHaveBeenCalledWith(expect.objectContaining({
      id: 'planning-pan-1993',
      issueId: 'PAN-1993',
      role: 'plan',
    }));
  });

  it('returns a descriptive error after GitHub issue fetch retries are exhausted', async () => {
    mockGitHubGetIssue.mockReturnValue(Effect.fail(new IssueNotFound({ id: 'PAN-1993' })));

    const resultPromise = postStartPlanning('PAN-1993');
    await vi.advanceTimersByTimeAsync(250 + 500 + 750 + 1000);
    const result = await resultPromise;

    expect(result.status).toBe(502);
    expect(result.body.error).toContain('could not fetch PAN-1993 from GitHub after 5 attempts');
    expect(mockGitHubGetIssue).toHaveBeenCalledTimes(5);
    expect(mockSpawnPlanningSession).not.toHaveBeenCalled();
  });
});
