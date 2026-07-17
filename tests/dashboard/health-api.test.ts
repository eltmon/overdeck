import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  buildGodviewSystemHealthResponse,
  buildHealthAgentsResponse,
  buildSystemHealthResponse,
} from '../../src/dashboard/server/routes/misc/health.js';

const NOW = Date.parse('2026-07-16T12:00:00.000Z');

type ResponseBody = Record<string, unknown> | Array<Record<string, unknown>>;

async function runResponse(
  effect:
    | ReturnType<typeof buildHealthAgentsResponse>
    | ReturnType<typeof buildSystemHealthResponse>
    | ReturnType<typeof buildGodviewSystemHealthResponse>,
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

function systemHealthSnapshot(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 2,
    state: 'healthy',
    updatedAt: '2026-07-16T12:00:00.000Z',
    nextPollMs: 15_000,
    host: {
      state: 'healthy',
      platform: 'linux',
      reasons: [],
      metrics: {
        cpuPercent: 12,
        loadAverage1m: 1.2,
        loadPerCore1m: 0.15,
        totalMemoryBytes: 32 * 1024 ** 3,
        usedMemoryBytes: 12 * 1024 ** 3,
        availableMemoryBytes: 20 * 1024 ** 3,
        memoryUsedPercent: 37.5,
        memoryPressureSomeAvg10: 0,
        memoryPressureFullAvg10: 0,
        memoryPressureFreePercent: null,
        swapTotalBytes: 8 * 1024 ** 3,
        swapUsedBytes: 0,
        swapUsedPercent: 0,
        swapActivityBytesPerMinute: 0,
        committedMemoryBytes: 10 * 1024 ** 3,
        commitLimitBytes: 40 * 1024 ** 3,
        virtualCommitmentPercent: 25,
      },
    },
    admission: {
      state: 'open',
      availableMemoryBytes: 20 * 1024 ** 3,
      admittedWorkAgentCount: 1,
      reasons: [],
    },
    agents: [],
    services: [{
      id: 'smee-relay',
      label: 'Webhook relay',
      required: false,
      status: 'not_configured',
      message: 'Webhook relay is not configured.',
      reasons: [],
    }],
    topConsumers: [],
    summary: {
      cpuPercent: 12,
      loadAverage1m: 1.2,
      loadPerCore1m: 0.15,
      totalMemoryBytes: 32 * 1024 ** 3,
      usedMemoryBytes: 12 * 1024 ** 3,
      availableMemoryBytes: 20 * 1024 ** 3,
      memoryUsedPercent: 37.5,
      swapTotalBytes: 8 * 1024 ** 3,
      swapUsedBytes: 0,
      swapUsedPercent: 0,
      committedMemoryBytes: 10 * 1024 ** 3,
      commitLimitBytes: 40 * 1024 ** 3,
      overcommitPercent: 25,
      agentCount: 0,
      workAgentCount: 0,
      planningAgentCount: 0,
      specialistSessionCount: 0,
      leakedSpecialistCount: 0,
      containerCount: 0,
      containerMemoryBytes: 0,
      overdeckMemoryBytes: 0,
      overdeckMemoryPercent: 0,
      smeeRelay: {
        configured: false,
        running: false,
        status: 'not_configured',
        message: 'Webhook relay is not configured.',
      },
    },
    ...overrides,
  };
}

describe('accepted system health routes', () => {
  it('decodes one accepted snapshot and keeps God View evidence aligned', async () => {
    const accepted = systemHealthSnapshot();
    const system = await runResponse(buildSystemHealthResponse({
      snapshot: Effect.succeed(accepted),
    }));
    const godview = await runResponse(buildGodviewSystemHealthResponse({
      snapshot: Effect.succeed(accepted),
    }));

    expect(system.status).toBe(200);
    expect(godview.status).toBe(200);
    expect(godview.body).toMatchObject({
      version: 2,
      state: system.body['state'],
      host: system.body['host'],
      admission: system.body['admission'],
      cpu: 12,
      memPercent: 37.5,
      memUsed: 12 * 1024 ** 3,
      memTotal: 32 * 1024 ** 3,
      updatedAt: '2026-07-16T12:00:00.000Z',
    });
  });

  it('keeps unavailable host signals as null in an otherwise valid HTTP 200 snapshot', async () => {
    const accepted = systemHealthSnapshot({
      state: 'unavailable',
      host: {
        ...(systemHealthSnapshot()['host'] as Record<string, unknown>),
        state: 'unavailable',
        reasons: [{
          code: 'host.current_pressure.unavailable',
          domain: 'host',
          severity: 'info',
          message: 'Current pressure could not be measured.',
        }],
        metrics: {
          ...((systemHealthSnapshot()['host'] as Record<string, unknown>)['metrics'] as Record<string, unknown>),
          memoryPressureSomeAvg10: null,
          memoryPressureFullAvg10: null,
        },
      },
    });
    const response = await runResponse(buildSystemHealthResponse({
      snapshot: Effect.succeed(accepted),
    }));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      state: 'unavailable',
      host: {
        state: 'unavailable',
        metrics: {
          memoryPressureSomeAvg10: null,
          memoryPressureFullAvg10: null,
        },
      },
    });
  });

  it.each([
    ['production failure', Effect.fail(new Error('collector offline'))],
    ['shared-schema failure', Effect.succeed({ version: 1 })],
  ])('returns one structured HTTP 503 body on %s', async (_label, health) => {
    const system = await runResponse(buildSystemHealthResponse({ snapshot: health }));
    const godview = await runResponse(buildGodviewSystemHealthResponse({ snapshot: health }));

    expect(system.status).toBe(503);
    expect(godview.status).toBe(503);
    expect(system.body).toEqual(godview.body);
    expect(system.body).toEqual({
      status: 'unavailable',
      reasons: [{
        code: 'system.health_snapshot.unavailable',
        domain: 'host',
        severity: 'critical',
        message: 'The accepted system health snapshot could not be produced or decoded.',
      }],
    });
  });
});

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
