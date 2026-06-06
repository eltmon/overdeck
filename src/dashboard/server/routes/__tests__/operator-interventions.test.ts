import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context, Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { EventStoreService } from '../../services/domain-services.js';

const fsMocks = vi.hoisted(() => ({
  appendFile: vi.fn(),
  mkdir: vi.fn(),
}));

const agentMocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  setAgentPaused: vi.fn(),
  saveAgentState: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  restartAgent: vi.fn(),
  messageAgent: vi.fn(),
}));

const tmuxMocks = vi.hoisted(() => ({
  sessionExists: vi.fn(),
  killSession: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
  resetToTodo: vi.fn(),
}));

const projectMocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  extractTeamPrefix: vi.fn(),
  findProjectByTeamSync: vi.fn(),
}));

const trackerMocks = vi.hoisted(() => ({
  resolveGitHubIssueSync: vi.fn(),
  resolveTrackerTypeSync: vi.fn(),
}));

const issueServiceMock = vi.hoisted(() => ({
  getIssueSource: vi.fn(),
  patchIssue: vi.fn(),
  invalidateTracker: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    appendFile: fsMocks.appendFile,
    mkdir: fsMocks.mkdir,
  };
});

vi.mock('../origin-validation.js', () => ({
  validateOrigin: vi.fn(() => ({ ok: true })),
  _resetTrustedOriginsForTests: vi.fn(),
}));

vi.mock('../../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/agents.js')>();
  return {
    ...actual,
    getAgentState: agentMocks.getAgentState,
    setAgentPaused: agentMocks.setAgentPaused,
    saveAgentState: agentMocks.saveAgentState,
    saveAgentRuntimeState: agentMocks.saveAgentRuntimeState,
    restartAgent: agentMocks.restartAgent,
    messageAgent: agentMocks.messageAgent,
  };
});

vi.mock('../../../../lib/tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/tmux.js')>();
  return {
    ...actual,
    sessionExists: tmuxMocks.sessionExists,
    killSession: tmuxMocks.killSession,
  };
});

vi.mock('../../../../lib/lifecycle/index.js', () => ({
  resetToTodo: lifecycleMocks.resetToTodo,
  cancelIssueWorkflow: vi.fn(),
  closeOut: vi.fn(),
}));

vi.mock('../../../../lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/projects.js')>();
  return {
    ...actual,
    resolveProjectFromIssueSync: projectMocks.resolveProjectFromIssueSync,
    extractTeamPrefix: projectMocks.extractTeamPrefix,
    findProjectByTeamSync: projectMocks.findProjectByTeamSync,
  };
});

vi.mock('../../../../lib/tracker-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/tracker-utils.js')>();
  return {
    ...actual,
    resolveGitHubIssueSync: trackerMocks.resolveGitHubIssueSync,
    resolveTrackerTypeSync: trackerMocks.resolveTrackerTypeSync,
  };
});

vi.mock('../../services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => issueServiceMock,
}));

vi.mock('../../review-status.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../review-status.js')>();
  return {
    ...actual,
    clearReviewStatus: vi.fn(),
  };
});

vi.mock('../../../../lib/cloister/merge-agent.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/cloister/merge-agent.js')>();
  return {
    ...actual,
    resetPostMergeState: vi.fn(),
  };
});

const agentsRouteLayerPromise = import('../agents.js').then((module) => module.agentsRouteLayer);
const issuesRouteLayerPromise = import('../issues.js').then((module) => module.issuesRouteLayer);

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
    emitOnly: (event: Record<string, unknown>) => Effect.sync(() => {
      appendedEvents.push(event);
      return appendedEvents.length;
    }),
    readFrom: () => Effect.succeed([]),
    queryByType: () => Effect.succeed([]),
    getLatestSequence: Effect.succeed(0),
    streamEvents: Stream.empty,
  });
}

async function runRoute(layer: Layer.Layer<HttpRouter.HttpRouter, never, EventStoreService>, path: string, init: RequestInit) {
  const appendedEvents: Record<string, unknown>[] = [];
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  }));

  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(layer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)
      ).pipe(Effect.provide(eventStoreLayerFor(appendedEvents))),
    ),
  );
  return { response, appendedEvents };
}

async function requestAgents(path: string, init: RequestInit = {}) {
  return runRoute(await agentsRouteLayerPromise, path, init);
}

async function requestIssues(path: string, init: RequestInit = {}) {
  return runRoute(await issuesRouteLayerPromise, path, init);
}

const agentState = {
  id: 'agent-pan-1',
  issueId: 'PAN-1',
  workspace: '/tmp/workspace',
  harness: 'claude-code',
  model: 'claude-sonnet-4-6',
  role: 'work',
  status: 'running',
  startedAt: '2026-05-25T00:00:00.000Z',
};

describe('operator.intervention dashboard routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.appendFile.mockResolvedValue(undefined);
    fsMocks.mkdir.mockResolvedValue(undefined);
    agentMocks.getAgentState.mockReturnValue(Effect.succeed(agentState));
    agentMocks.setAgentPaused.mockReturnValue(Effect.succeed({ ...agentState, paused: true, status: 'stopped' }));
    agentMocks.saveAgentState.mockReturnValue(Effect.succeed(undefined));
    agentMocks.saveAgentRuntimeState.mockResolvedValue(undefined);
    agentMocks.restartAgent.mockResolvedValue({ success: true });
    agentMocks.messageAgent.mockResolvedValue(undefined);
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(false));
    tmuxMocks.killSession.mockReturnValue(Effect.succeed(undefined));
    lifecycleMocks.resetToTodo.mockReturnValue(Effect.succeed({ success: true, steps: [] }));
    projectMocks.extractTeamPrefix.mockReturnValue('PAN');
    projectMocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/tmp/project', projectName: 'panopticon' });
    projectMocks.findProjectByTeamSync.mockReturnValue({ name: 'panopticon', workspace: {} });
    trackerMocks.resolveGitHubIssueSync.mockReturnValue({ isGitHub: false });
    trackerMocks.resolveTrackerTypeSync.mockReturnValue('github');
    issueServiceMock.getIssueSource.mockReturnValue('github');
    issueServiceMock.patchIssue.mockReturnValue(undefined);
    issueServiceMock.invalidateTracker.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('emits pause from the successful dashboard pause route', async () => {
    const { response, appendedEvents } = await requestAgents('/api/agents/agent-pan-1/pause', {
      body: JSON.stringify({ reason: 'operator' }),
    });

    expect(response.status).toBe(200);
    expect(appendedEvents).toContainEqual(expect.objectContaining({
      type: 'operator.intervention',
      payload: { issueId: 'PAN-1', kind: 'pause', source: 'dashboard' },
    }));
  }, 15_000);

  it('emits restart from the successful dashboard restart route and forwards harness overrides', async () => {
    const { response, appendedEvents } = await requestAgents('/api/agents/agent-pan-1/restart', {
      body: JSON.stringify({ model: 'gpt-5.5', harness: 'pi', graceful: false }),
    });

    expect(response.status).toBe(200);
    expect(agentMocks.restartAgent).toHaveBeenCalledWith('agent-pan-1', expect.objectContaining({
      model: 'gpt-5.5',
      harness: 'pi',
      graceful: false,
    }));
    expect(appendedEvents).toContainEqual(expect.objectContaining({
      type: 'operator.intervention',
      payload: { issueId: 'PAN-1', kind: 'restart', source: 'dashboard' },
    }));
  });

  it('does not emit an intervention when the agent request fails', async () => {
    agentMocks.getAgentState.mockReturnValue(Effect.succeed(null));

    const { response, appendedEvents } = await requestAgents('/api/agents/agent-pan-missing/pause', {
      body: JSON.stringify({ reason: 'operator' }),
    });

    expect(response.status).toBe(404);
    expect(appendedEvents).not.toContainEqual(expect.objectContaining({ type: 'operator.intervention' }));
  });

  it('sends dashboard messages with the user-message caller source', async () => {
    const { response } = await requestAgents('/api/agents/agent-pan-1/message', {
      body: JSON.stringify({ message: 'please continue' }),
    });

    expect(response.status).toBe(200);
    expect(agentMocks.messageAgent).toHaveBeenCalledWith('agent-pan-1', 'please continue', 'dashboard:user-message');
  });

  it('emits deep_wipe from the successful dashboard deep-wipe route', async () => {
    const { response, appendedEvents } = await requestIssues('/api/issues/PAN-1/deep-wipe', {
      body: JSON.stringify({ deleteWorkspace: false }),
    });

    expect(response.status).toBe(200);
    await vi.waitFor(() => {
      expect(appendedEvents).toContainEqual(expect.objectContaining({
        type: 'operator.intervention',
        payload: { issueId: 'PAN-1', kind: 'deep_wipe', source: 'dashboard' },
      }));
    });
  });

  it('does not emit an intervention when the deep-wipe request is invalid', async () => {
    const { response, appendedEvents } = await requestIssues('/api/issues/not-an-id/deep-wipe', {
      body: JSON.stringify({ deleteWorkspace: false }),
    });

    expect(response.status).toBe(400);
    expect(appendedEvents).not.toContainEqual(expect.objectContaining({ type: 'operator.intervention' }));
  });
});
