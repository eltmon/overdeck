/**
 * PAN-3925: GET /api/agents derives stopped agents' issues in one batch.
 *
 * The route used to call the single-issue door once per stopped agent — three
 * `git` spawns and a forge lookup each, for every registered agent. It now
 * collects the stopped agents' issue ids and makes one
 * `loadIssueStatesForIssues` call, then reads each answer from that map.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedIssueState } from '@overdeck/contracts';

const mocks = vi.hoisted(() => ({
  listAgentStates: vi.fn(),
  getBackendPanes: vi.fn(),
  loadIssueStatesForIssues: vi.fn(),
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
  loadIssueStatesForIssues: mocks.loadIssueStatesForIssues,
}));

vi.mock('../agents/shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agents/shared.js')>();
  return {
    ...actual,
    readRemoteAgentState: vi.fn(async () => ({})),
  };
});

const { getAgentsRoute } = await import('../agents/listing.js');
const { agentsCache } = await import('../agents/shared.js');

const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

function stoppedAgent(id: string, issueId: string) {
  return {
    id,
    issueId,
    workspace: `/tmp/pan-3925-test/${id}`,
    role: 'work',
    status: 'stopped',
    startedAt: TWO_HOURS_AGO,
    lastActivity: TWO_HOURS_AGO,
  };
}

function derived(issueId: string, state: DerivedIssueState['state'], pr?: number): DerivedIssueState {
  return {
    issueId,
    state,
    ...(pr ? { pr: { url: `https://github.com/o/r/pull/${pr}`, number: pr, reviewState: 'none', checks: 'pending', mergeable: null } } : {}),
  } as DerivedIssueState;
}

async function getAgents(): Promise<Array<{ id: string }>> {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/agents'));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(getAgentsRoute), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const body = (response as unknown as { body: { body: Uint8Array } }).body.body;
  return JSON.parse(new TextDecoder().decode(body)) as Array<{ id: string }>;
}

describe('GET /api/agents stopped-agent derivation (PAN-3925)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentsCache.data = null;
    agentsCache.timestamp = 0;
    mocks.getBackendPanes.mockResolvedValue([]);
    mocks.listAgentStates.mockReturnValue([
      stoppedAgent('agent-pan-1', 'PAN-1'),
      stoppedAgent('strike-pan-1', 'PAN-1'),
      stoppedAgent('agent-pan-2', 'PAN-2'),
    ]);
  });

  it('derives every stopped agent issue in one batch call', async () => {
    mocks.loadIssueStatesForIssues.mockResolvedValue(new Map());

    await getAgents();

    expect(mocks.loadIssueStatesForIssues).toHaveBeenCalledTimes(1);
    const [ids] = mocks.loadIssueStatesForIssues.mock.calls[0] as [string[]];
    expect(new Set(ids)).toEqual(new Set(['PAN-1', 'PAN-2']));
  });

  it('keeps a long-stopped agent whose PR is in play and drops one whose issue merged', async () => {
    mocks.loadIssueStatesForIssues.mockResolvedValue(new Map([
      ['PAN-1', derived('PAN-1', 'in-review', 11)],
      ['PAN-2', derived('PAN-2', 'merged', 12)],
    ]));

    const ids = (await getAgents()).map((agent) => agent.id).sort();

    expect(ids).toEqual(['agent-pan-1', 'strike-pan-1']);
  });

  it('still answers when the batch fails, keeping only agents stopped within the hour', async () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mocks.listAgentStates.mockReturnValue([
      stoppedAgent('agent-pan-1', 'PAN-1'),
      { ...stoppedAgent('agent-pan-2', 'PAN-2'), lastActivity: recent },
    ]);
    mocks.loadIssueStatesForIssues.mockRejectedValue(new Error('forge down'));

    const ids = (await getAgents()).map((agent) => agent.id);

    expect(ids).toEqual(['agent-pan-2']);
  });
});
