import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context, Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { EventStoreService } from '../../services/domain-services.js';
import { IssueLifecycle } from '../../services/issue-lifecycle.js';
import { ReadModelService, type ReadModelServiceShape } from '../../read-model.js';

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
  clearAgentPausedSync: vi.fn(),
  clearAgentTroubledSync: vi.fn(),
  clearAgentPaused: vi.fn(),
  clearAgentTroubled: vi.fn(),
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

const operatorInterventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(() => Promise.resolve()),
}));

const sharedMocks = vi.hoisted(() => ({
  getIssueDataService: vi.fn(() => ({
    getIssues: vi.fn(() => []),
    patchIssue: vi.fn(),
    invalidateTracker: vi.fn(),
  })),
}));

vi.mock('../../../../lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: operatorInterventionMocks.appendOperatorInterventionEvent,
  operatorInterventionEvent: (input: any) => ({
    type: 'operator.intervention',
    timestamp: input.timestamp ?? new Date().toISOString(),
    payload: { issueId: input.issueId, kind: input.kind, source: input.source },
  }),
}));

vi.mock('../agents/shared.js', async (importActual) => {
  const actual = await importActual<typeof import('../agents/shared.js')>();
  return { ...actual, getIssueDataService: sharedMocks.getIssueDataService };
});

const issueServiceMock = vi.hoisted(() => ({
  getIssueSource: vi.fn(),
  patchIssue: vi.fn(),
  invalidateTracker: vi.fn(),
  getIssues: vi.fn(),
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

// The spawn route resolves the closed-issue guard via getIssueDataService(),
// whose implementation does a lazy require() of the issue-service singleton.
// Under vitest that dynamic require can't resolve the .js→.ts source path, so
// override the exported binding on the shared module (everything else stays
// real via ...actual) to return the in-memory issueServiceMock.
vi.mock('../agents/shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agents/shared.js')>();
  return {
    ...actual,
    getIssueDataService: () => issueServiceMock,
  };
});

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
    clearAgentPausedSync: agentMocks.clearAgentPausedSync,
    clearAgentTroubledSync: agentMocks.clearAgentTroubledSync,
    clearAgentPaused: agentMocks.clearAgentPaused,
    clearAgentTroubled: agentMocks.clearAgentTroubled,
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

vi.mock('../../services/agent-projection.js', () => ({
  saveAgentStateAndEmitEventProgram: vi.fn(() => Effect.void),
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

let agentsRouteLayer: Layer.Layer<HttpRouter.HttpRouter, never, EventStoreService>;
let issuesRouteLayer: Layer.Layer<HttpRouter.HttpRouter, never, EventStoreService>;

beforeAll(async () => {
  agentsRouteLayer = (await import('../agents.js')).agentsRouteLayer;
  issuesRouteLayer = (await import('../issues.js')).issuesRouteLayer;
}, 15_000);

function routeTestLayerFor(appendedEvents: Record<string, unknown>[]) {
  const eventStoreLayer = Layer.succeed(EventStoreService, {
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

  const issueLifecycleLayer = Layer.succeed(IssueLifecycle, {
    transitionTo: () => Effect.void,
    addLabel: () => Effect.void,
    removeLabel: () => Effect.void,
    close: () => Effect.void,
  });

  const readModelLayer = Layer.succeed(ReadModelService, {
    getSnapshot: Effect.succeed({ agents: [], issues: [], conversations: [], workspaces: [] }),
    getIssueById: () => Effect.succeed(null),
  } as any);

  return eventStoreLayer.pipe(Layer.merge(issueLifecycleLayer), Layer.merge(readModelLayer));
}

// The spawn route (POST /api/agents) pulls IssueLifecycle and ReadModelService
// unconditionally at the top of its handler. The clearGates gate path under
// test never calls them, but Effect resolves every yield* eagerly, so the tags
// must be provided or the route 500s with "Service not found" before the gate.
const issueLifecycleStub = {
  transitionTo: vi.fn(() => Effect.void),
  addLabel: vi.fn(() => Effect.void),
  removeLabel: vi.fn(() => Effect.void),
  close: vi.fn(() => Effect.void),
};

const readModelStub = {
  getSnapshot: Effect.succeed(null),
  getChannelPermissionRequest: vi.fn(() => Effect.succeed(null)),
  getResolvedChannelPermissionDecision: vi.fn(() => Effect.succeed(null)),
  getTurnDiffSummaries: vi.fn(() => Effect.succeed([])),
  getAgentIdBySessionId: vi.fn(() => Effect.succeed(null)),
  applyEvent: vi.fn(),
  bootstrap: Effect.void,
} as unknown as ReadModelServiceShape;

function routeServicesLayer(appendedEvents: Record<string, unknown>[]) {
  return Layer.mergeAll(
    eventStoreLayerFor(appendedEvents),
    Layer.succeed(IssueLifecycle, issueLifecycleStub),
    Layer.succeed(ReadModelService, readModelStub),
  );
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
      ).pipe(Effect.provide(routeTestLayerFor(appendedEvents))),
    ),
  );
  return { response, appendedEvents };
}

async function requestAgents(path: string, init: RequestInit = {}) {
  return runRoute(agentsRouteLayer, path, init);
}

async function requestIssues(path: string, init: RequestInit = {}) {
  return runRoute(issuesRouteLayer, path, init);
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
    agentMocks.clearAgentPausedSync.mockReturnValue(true);
    agentMocks.clearAgentTroubledSync.mockReturnValue(true);
    agentMocks.clearAgentPaused.mockReturnValue(Effect.succeed({ ...agentState, paused: false }));
    agentMocks.clearAgentTroubled.mockReturnValue(Effect.succeed({ ...agentState, troubled: false, consecutiveFailures: 0 }));
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(false));
    tmuxMocks.killSession.mockReturnValue(Effect.succeed(undefined));
    lifecycleMocks.resetToTodo.mockReturnValue(Effect.succeed({ success: true, steps: [] }));
    projectMocks.extractTeamPrefix.mockReturnValue('PAN');
    projectMocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/tmp/project', projectName: 'overdeck' });
    projectMocks.findProjectByTeamSync.mockReturnValue({ name: 'overdeck', workspace: {} });
    trackerMocks.resolveGitHubIssueSync.mockReturnValue({ isGitHub: false });
    trackerMocks.resolveTrackerTypeSync.mockReturnValue('github');
    issueServiceMock.getIssueSource.mockReturnValue('github');
    issueServiceMock.patchIssue.mockReturnValue(undefined);
    issueServiceMock.invalidateTracker.mockResolvedValue(undefined);
    // The spawn route's closed-issue guard calls getIssueDataService().getIssues();
    // returning [] means "not found among cached issues", so the guard is skipped
    // and the request reaches the start-gate (clearGates) logic under test.
    issueServiceMock.getIssues.mockReturnValue([]);
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
  });

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

  it('refuses to start a paused agent from the dashboard without clearGates', async () => {
    agentMocks.getAgentState.mockReturnValue(
      Effect.succeed({ ...agentState, status: 'stopped', paused: true, pausedReason: 'manual inspection' }),
    );

    const { response } = await requestAgents('/api/agents', {
      body: JSON.stringify({ issueId: 'PAN-1' }),
    });

    expect(response.status).toBe(409);
    expect(agentMocks.clearAgentPaused).not.toHaveBeenCalled();
    expect(operatorInterventionMocks.appendOperatorInterventionEvent).not.toHaveBeenCalled();
  });

  it('refuses to start a troubled agent from the dashboard without clearGates', async () => {
    agentMocks.getAgentState.mockReturnValue(
      Effect.succeed({ ...agentState, status: 'stopped', troubled: true, consecutiveFailures: 3 }),
    );

    const { response } = await requestAgents('/api/agents', {
      body: JSON.stringify({ issueId: 'PAN-1' }),
    });

    expect(response.status).toBe(409);
    expect(agentMocks.clearAgentTroubled).not.toHaveBeenCalled();
  });

  it('honors clearGates by clearing a paused gate and emitting an operator intervention', async () => {
    agentMocks.getAgentState
      .mockReturnValueOnce(Effect.succeed({ ...agentState, status: 'stopped', paused: true, pausedReason: 'manual inspection' }))
      .mockReturnValueOnce(Effect.succeed({ ...agentState, status: 'stopped' }));

    const { response } = await requestAgents('/api/agents', {
      body: JSON.stringify({ issueId: 'PAN-1', clearGates: true }),
    });

    expect(agentMocks.clearAgentPaused).toHaveBeenCalledWith('agent-pan-1');
    expect(operatorInterventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'PAN-1', kind: 'unpause', source: 'dashboard start-agent' }),
    );
    expect(response.status).not.toBe(409);
  });

  it('honors clearGates by clearing a troubled gate and emitting an operator intervention', async () => {
    agentMocks.getAgentState
      .mockReturnValueOnce(Effect.succeed({ ...agentState, status: 'stopped', troubled: true, consecutiveFailures: 3 }))
      .mockReturnValueOnce(Effect.succeed({ ...agentState, status: 'stopped' }));

    const { response } = await requestAgents('/api/agents', {
      body: JSON.stringify({ issueId: 'PAN-1', clearGates: true }),
    });

    expect(agentMocks.clearAgentTroubled).toHaveBeenCalledWith('agent-pan-1');
    expect(operatorInterventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'PAN-1', kind: 'untroubled', source: 'dashboard start-agent' }),
    );
    expect(response.status).not.toBe(409);
  });

  // ── PAN-2499 WI-9a: clearGates on POST /api/agents ─────────────────────────
  // The spawn route must clear the troubled/paused gate through the same door
  // functions pan untroubled / pan unpause use and emit the matching intervention
  // event — and must refuse (not silently no-op) when clearGates is absent.

  it('clears the troubled gate and emits untroubled when clearGates is set on spawn (AC1)', async () => {
    agentMocks.getAgentState.mockReturnValue(
      Effect.succeed({ ...agentState, troubled: true, consecutiveFailures: 2 }),
    );

    const { appendedEvents } = await requestAgents('/api/agents', {
      body: JSON.stringify({ issueId: 'PAN-1', clearGates: true }),
    });

    expect(agentMocks.clearAgentTroubledSync).toHaveBeenCalledWith('agent-pan-1');
    expect(agentMocks.clearAgentPausedSync).not.toHaveBeenCalled();
    expect(appendedEvents).toContainEqual(expect.objectContaining({
      type: 'operator.intervention',
      payload: { issueId: 'PAN-1', kind: 'untroubled', source: 'dashboard' },
    }));
  });

  it('clears the paused gate and emits unpause when clearGates is set on spawn (AC2)', async () => {
    agentMocks.getAgentState.mockReturnValue(
      Effect.succeed({ ...agentState, paused: true, pausedReason: 'operator' }),
    );

    const { appendedEvents } = await requestAgents('/api/agents', {
      body: JSON.stringify({ issueId: 'PAN-1', clearGates: true }),
    });

    expect(agentMocks.clearAgentPausedSync).toHaveBeenCalledWith('agent-pan-1');
    expect(agentMocks.clearAgentTroubledSync).not.toHaveBeenCalled();
    expect(appendedEvents).toContainEqual(expect.objectContaining({
      type: 'operator.intervention',
      payload: { issueId: 'PAN-1', kind: 'unpause', source: 'dashboard' },
    }));
  });

  it('refuses a gated spawn without clearGates and clears nothing (AC3)', async () => {
    agentMocks.getAgentState.mockReturnValue(
      Effect.succeed({ ...agentState, paused: true, pausedReason: 'operator' }),
    );

    const { response } = await requestAgents('/api/agents', {
      body: JSON.stringify({ issueId: 'PAN-1' }),
    });

    expect(response.status).toBe(409);
    expect(agentMocks.clearAgentPausedSync).not.toHaveBeenCalled();
    expect(agentMocks.clearAgentTroubledSync).not.toHaveBeenCalled();
  });
});
