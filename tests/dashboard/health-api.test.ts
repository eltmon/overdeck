import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildHealthAgentsResponse } from '../../src/dashboard/server/routes/misc/health.js';

const NOW = Date.parse('2026-07-16T12:00:00.000Z');

type ResponseBody = Record<string, unknown> | Array<Record<string, unknown>>;

async function runResponse(
  effect: ReturnType<typeof buildHealthAgentsResponse>,
): Promise<{ status: number; body: ResponseBody }> {
  const response = await Effect.runPromise(effect);
  const raw = response.body as { body: Uint8Array } | null;
  const text = raw?.body ? new TextDecoder().decode(raw.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as ResponseBody };
}

function agent(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    issueId: 'PAN-2647',
    role: 'work',
    status: 'running',
    startedAt: '2026-07-16T11:50:00.000Z',
    lastActivity: '2026-07-16T11:59:00.000Z',
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agents: [],
    agentRuntimeById: {},
    reviewStatuses: [],
    ...overrides,
  };
}

describe('GET /api/health/agents response', () => {
  it('keeps healthy agents visible when another canonical entry is malformed', async () => {
    const { status, body } = await runResponse(buildHealthAgentsResponse({
      snapshot: Effect.succeed(snapshot({
        agents: [
          agent('agent-healthy'),
          agent('agent-corrupt', { status: 'not-a-real-status' }),
        ],
      })),
      sessionNames: Effect.succeed(['agent-healthy']),
      readObservations: async () => ({}),
      nowMs: NOW,
    }));

    expect(status).toBe(200);
    expect(body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent-healthy', status: 'healthy' }),
      expect.objectContaining({
        id: 'agent-corrupt',
        status: 'unavailable',
        reasons: [expect.objectContaining({
          code: 'agent.persisted_state.unavailable',
        })],
      }),
    ]));
  });

  it('returns structured unavailable evidence with a non-2xx status on whole-read failure', async () => {
    const { status, body } = await runResponse(buildHealthAgentsResponse({
      snapshot: Effect.fail(new Error('resolver offline')),
      sessionNames: Effect.succeed([]),
      nowMs: NOW,
    }));

    expect(status).toBe(503);
    expect(body).toEqual({
      status: 'unavailable',
      reasons: [{
        code: 'agent.health_snapshot.unavailable',
        domain: 'agent',
        severity: 'critical',
        message: 'The canonical agent health snapshot could not be loaded.',
      }],
    });
  });

  it('returns real activity, preserves zero context, and never fabricates lastPing', async () => {
    const lastActivityAt = '2026-07-16T11:59:30.000Z';
    const { status, body } = await runResponse(buildHealthAgentsResponse({
      snapshot: Effect.succeed(snapshot({
        agents: [agent('agent-zero-context')],
        agentRuntimeById: {
          'agent-zero-context': {
            id: 'agent-zero-context',
            activity: 'working',
            lastActivity: lastActivityAt,
            updatedAtSequence: 1,
          },
        },
      })),
      sessionNames: Effect.succeed(['agent-zero-context']),
      readObservations: async () => ({ contextPercent: 0 }),
      nowMs: NOW,
    }));

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const [health] = body as Array<Record<string, unknown>>;
    expect(health).toMatchObject({
      id: 'agent-zero-context',
      status: 'healthy',
      lastActivityAt,
      contextPercent: 0,
    });
    expect(health).not.toHaveProperty('lastPing');
  });

  it('keeps terminal specialists warm and human-blocked work agents waiting', async () => {
    const oldActivity = '2026-07-16T10:00:00.000Z';
    const { status, body } = await runResponse(buildHealthAgentsResponse({
      snapshot: Effect.succeed(snapshot({
        agents: [
          agent('agent-pan-2647-review', {
            role: 'review',
            lastActivity: oldActivity,
          }),
          agent('agent-pan-2647', { lastActivity: oldActivity }),
        ],
        agentRuntimeById: {
          'agent-pan-2647-review': {
            id: 'agent-pan-2647-review',
            activity: 'working',
            lastActivity: oldActivity,
            updatedAtSequence: 2,
          },
          'agent-pan-2647': {
            id: 'agent-pan-2647',
            activity: 'waiting',
            lastActivity: oldActivity,
            updatedAtSequence: 3,
          },
        },
        reviewStatuses: [{
          issueId: 'PAN-2647',
          reviewStatus: 'passed',
        }],
      })),
      sessionNames: Effect.succeed([
        'agent-pan-2647-review',
        'agent-pan-2647',
      ]),
      readObservations: async () => ({}),
      nowMs: NOW,
    }));

    expect(status).toBe(200);
    expect(body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'agent-pan-2647-review',
        status: 'idle',
        lifecycle: 'warm',
      }),
      expect.objectContaining({
        id: 'agent-pan-2647',
        status: 'waiting',
        reasons: [expect.objectContaining({
          code: 'agent.runtime.waiting_on_human',
        })],
      }),
    ]));
  });
});
