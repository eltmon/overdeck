/**
 * #4105: GET /api/agents reports pane liveness as `hasLivePane`. The old name,
 * `hasLiveTmuxSession`, was always true for a live pane on either backend, so
 * it stays only as a deprecated alias carrying the same value.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAgentStates: vi.fn(),
  getBackendPanes: vi.fn(),
}));

vi.mock('../../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/agents.js')>();
  const { Effect: E } = await import('effect');
  return {
    ...actual,
    listAgentStates: mocks.listAgentStates,
    getAgentRuntimeState: () => E.succeed(null),
  };
});

vi.mock('../../services/backend-inventory.js', () => ({
  getBackendPanes: mocks.getBackendPanes,
}));

vi.mock('../../services/derived-issue-state.js', () => ({
  loadIssueStatesForIssues: vi.fn(async () => new Map()),
}));

vi.mock('../../../../lib/agent-enrichment.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/agent-enrichment.js')>()),
  computeAgentEnrichment: vi.fn(async () => ({ hasPendingQuestion: false, pendingQuestionCount: 0 })),
}));

vi.mock('../agents/shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agents/shared.js')>();
  return {
    ...actual,
    readRemoteAgentState: vi.fn(async () => ({})),
    getWorkspaceLocation: vi.fn(async () => 'local'),
    getGitStatusAsync: vi.fn(async () => null),
  };
});

const { getAgentsRoute } = await import('../agents/listing.js');
const { agentsCache } = await import('../agents/shared.js');

type Row = { id: string; hasLivePane?: boolean; hasLiveTmuxSession?: boolean };

async function getAgents(): Promise<Row[]> {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/agents'));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(getAgentsRoute), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const body = (response as unknown as { body: { body: Uint8Array } }).body.body;
  return JSON.parse(new TextDecoder().decode(body)) as Row[];
}

const NOW = new Date().toISOString();

function agent(id: string) {
  return { id, issueId: 'PAN-4105', workspace: `/tmp/pan-4105-test/${id}`, role: 'work', status: 'running', startedAt: NOW, lastActivity: NOW };
}

describe('GET /api/agents hasLivePane (#4105)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentsCache.data = null;
    agentsCache.timestamp = 0;
    mocks.listAgentStates.mockReturnValue([agent('agent-pan-4105'), agent('strike-pan-4105')]);
    // A Herdr pane for the work agent; the strike agent has no pane at all.
    mocks.getBackendPanes.mockResolvedValue([
      { id: 'wA:p1', terminalId: 'agent-pan-4105', issue: 'PAN-4105', role: 'work', state: 'working', harness: 'claude-code', model: 'unknown' },
    ]);
  });

  it('reports a live pane as hasLivePane and keeps the deprecated alias in step', async () => {
    const rows = new Map((await getAgents()).map((row) => [row.id, row]));

    expect(rows.get('agent-pan-4105')).toMatchObject({ hasLivePane: true, hasLiveTmuxSession: true });
    expect(rows.get('strike-pan-4105')).toMatchObject({ hasLivePane: false, hasLiveTmuxSession: false });
  });
});
