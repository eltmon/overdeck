import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { describe, expect, it, vi } from 'vitest';

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
  ];

  return {
    agents,
    candidates: [agents[0]],
  };
});

vi.mock('../../../../lib/cloister/boot-reconciliation.js', () => ({
  isBootReconciliationCandidate: vi.fn((agent: { id: string }) => agent.id === 'agent-candidate'),
  listBootReconciliationCandidates: vi.fn(() => mocks.candidates),
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
  getBootReconciliationState: vi.fn(() => ({
    decision: 'pending',
    perAgent: {},
    decidedAt: null,
    bootId: 'boot-test',
    bootStartedAt: '2026-06-29T15:00:00.000Z',
    graceDeadline: '2026-06-29T15:00:30.000Z',
  })),
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
  it('omits stale stopped non-candidates while retaining read-only context rows', async () => {
    const response = await requestRoute('/api/boot-reconciliation');

    expect(response.status).toBe(200);
    const ids = response.body.set.map((agent: { id: string }) => agent.id);
    expect(ids).toEqual(['agent-candidate', 'agent-paused', 'agent-troubled', 'agent-remote']);
    expect(ids).not.toContain('agent-stale');
    expect(response.body.set.find((agent: { id: string }) => agent.id === 'agent-candidate').readOnly).toBe(false);
    for (const id of ['agent-paused', 'agent-troubled', 'agent-remote']) {
      expect(response.body.set.find((agent: { id: string }) => agent.id === id).readOnly).toBe(true);
    }
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
