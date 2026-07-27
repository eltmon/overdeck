import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const agents = [
    {
      id: 'agent-candidate',
      issueId: 'PAN-1',
      role: 'work',
      status: 'stopped',
      model: 'claude',
      lastActivity: '2026-06-29T14:59:58.000Z',
      updatedAt: '2026-06-29T14:59:59.000Z',
      costSoFar: null,
      hostOverride: null,
      paused: false,
      troubled: false,
      stoppedByUser: false,
      sessionId: null,
    },
    {
      id: 'agent-stale',
      issueId: 'PAN-2',
      role: 'work',
      status: 'stopped',
      model: 'claude',
      lastActivity: '2026-06-17T03:00:00.000Z',
      updatedAt: '2026-06-17T03:00:00.000Z',
      costSoFar: null,
      hostOverride: null,
      paused: false,
      troubled: false,
      stoppedByUser: false,
      sessionId: null,
    },
    {
      id: 'agent-paused',
      issueId: 'PAN-3',
      role: 'work',
      status: 'stopped',
      model: 'claude',
      lastActivity: '2026-06-29T14:59:58.000Z',
      updatedAt: '2026-06-29T14:59:59.000Z',
      costSoFar: null,
      hostOverride: null,
      paused: true,
      pausedReason: 'operator hold',
      troubled: false,
      stoppedByUser: false,
      sessionId: null,
    },
    {
      id: 'agent-troubled',
      issueId: 'PAN-4',
      role: 'work',
      status: 'stopped',
      model: 'claude',
      lastActivity: '2026-06-29T14:59:58.000Z',
      updatedAt: '2026-06-29T14:59:59.000Z',
      costSoFar: null,
      hostOverride: null,
      paused: false,
      troubled: true,
      stoppedByUser: false,
      sessionId: null,
    },
    {
      id: 'agent-remote',
      issueId: 'PAN-5',
      role: 'work',
      status: 'running',
      model: 'claude',
      lastActivity: '2026-06-29T14:59:58.000Z',
      updatedAt: '2026-06-29T14:59:59.000Z',
      costSoFar: null,
      hostOverride: 'remote-host',
      paused: false,
      troubled: false,
      stoppedByUser: false,
      sessionId: 'remote-session',
    },
    {
      id: 'agent-stopped-by-user',
      issueId: 'PAN-6',
      role: 'work',
      status: 'stopped',
      model: 'claude',
      lastActivity: '2026-06-29T14:59:58.000Z',
      updatedAt: '2026-06-29T14:59:59.000Z',
      costSoFar: null,
      hostOverride: null,
      paused: false,
      troubled: false,
      stoppedByUser: true,
      sessionId: null,
    },
    {
      id: 'agent-strike',
      issueId: 'PAN-7',
      role: 'strike',
      status: 'stopped',
      model: 'claude',
      lastActivity: '2026-06-29T14:59:58.000Z',
      updatedAt: '2026-06-29T14:59:59.000Z',
      costSoFar: null,
      hostOverride: null,
      paused: false,
      troubled: false,
      stoppedByUser: false,
      sessionId: null,
    },
  ];

  return {
    agents,
    candidates: [agents[0]],
    bootState: {
      decision: 'pending' as 'pending' | 'resume_all' | 'hold_all' | 'per_agent' | null,
      perAgent: {} as Record<string, 'resume' | 'hold'>,
      decidedAt: null as string | null,
      bootId: 'boot-test',
      bootStartedAt: '2026-06-29T15:00:00.000Z',
      graceDeadline: '2026-06-29T15:00:30.000Z',
    },
  };
});

vi.mock('../../../../lib/cloister/boot-reconciliation.js', () => ({
  isAutoResumableRole: vi.fn((role: string) => role === 'work' || role === 'strike'),
  isBootReconciliationCandidate: vi.fn((agent: { id: string }) =>
    mocks.candidates.some((candidate) => candidate.id === agent.id),
  ),
  listBootReconciliationCandidates: vi.fn(() => mocks.candidates),
  MAX_BOOT_RECONCILIATION_GRACE_EXTENSIONS: 3,
  extendBootReconciliationGrace: vi.fn(() => ({
    extended: true,
    graceDeadline: '2026-06-29T15:01:00.000Z',
    graceExtensions: 1,
    maxGraceExtensions: 3,
    reason: 'extended',
  })),
}));

vi.mock('../../../../lib/cloister/deacon.js', () => ({
  applyBootReconciliationDecision: vi.fn(async () => ({
    resumed: ['agent-candidate'],
    outcomes: [],
    skipped: {
      workspace_missing: 1,
      merged: 2,
      completed: 3,
      other: 4,
    },
    deferred: 5,
  })),
}));

vi.mock('../../../../lib/tmux.js', () => ({
  sessionExists: vi.fn(() => false),
}));

vi.mock('../../../../lib/overdeck/agents.js', () => ({
  listAllAgentsSync: vi.fn(() => mocks.agents),
}));

vi.mock('../../../../lib/overdeck/control-settings.js', () => ({
  getBootReconciliationState: vi.fn(() => ({ ...mocks.bootState })),
  setBootReconciliationDecision: vi.fn(),
}));

import { bootReconciliationRouteLayer } from '../boot-reconciliation.js';

async function requestRoute(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(bootReconciliationRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

describe('boot reconciliation route', () => {
  beforeEach(() => {
    mocks.candidates = [mocks.agents[0]];
    mocks.bootState.decision = 'pending';
    mocks.bootState.perAgent = {};
  });

  it('puts only decision candidates in set, read-only rows in context, and omits stale stopped non-candidates', async () => {
    const response = await requestRoute('/api/boot-reconciliation');

    expect(response.status).toBe(200);
    const setIds = response.body.set.map((agent: { id: string }) => agent.id);
    const contextIds = response.body.context.map((agent: { id: string }) => agent.id);
    expect(setIds).toEqual(['agent-candidate']);
    expect(contextIds).toEqual(['agent-paused', 'agent-troubled', 'agent-remote']);
    expect([...setIds, ...contextIds]).not.toContain('agent-stale');
    expect(response.body.maxGraceExtensions).toBe(3);
    expect(response.body.heldCount).toBe(0);
    expect(response.body.set.find((agent: { id: string }) => agent.id === 'agent-candidate').readOnly).toBe(false);
    for (const id of ['agent-paused', 'agent-troubled', 'agent-remote']) {
      expect(response.body.context.find((agent: { id: string }) => agent.id === id).readOnly).toBe(true);
    }
  });

  it('counts live hold_all candidates and exposes operator-stopped row state', async () => {
    mocks.bootState.decision = 'hold_all';
    mocks.candidates = [mocks.agents[0], mocks.agents[5]];

    const response = await requestRoute('/api/boot-reconciliation');

    expect(response.body.heldCount).toBe(2);
    const operatorStopped = response.body.set.find((agent: { id: string }) => agent.id === 'agent-stopped-by-user');
    expect(operatorStopped).toMatchObject({
      stoppedByUser: true,
      whyStopped: 'stopped by operator',
    });
  });

  it('subtracts per-agent resume marks and includes strike candidates', async () => {
    mocks.bootState.decision = 'per_agent';
    mocks.bootState.perAgent = { 'PAN-1': 'resume' };
    mocks.candidates = [mocks.agents[0], mocks.agents[6]];

    const response = await requestRoute('/api/boot-reconciliation');

    expect(response.body.set.map((agent: { id: string }) => agent.id)).toEqual([
      'agent-candidate',
      'agent-strike',
    ]);
    expect(response.body.heldCount).toBe(1);
  });

  it('returns skipped and deferred boot decision breakdowns', async () => {
    const response = await requestRoute('/api/boot-reconciliation/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: 'resume_all' }),
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      count: 1,
      resumed: ['agent-candidate'],
      skipped: {
        workspace_missing: 1,
        merged: 2,
        completed: 3,
        other: 4,
      },
      deferred: 5,
    });
  });
});
