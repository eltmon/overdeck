import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/activity-logger.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../lib/activity-logger.js')>(),
  emitActivityEntry: vi.fn(),
}));

import { evaluateAgentStartGate, evaluateSpawnGuardrails, hasActiveAgentGateOrRetry } from '../agents.js';
import {
  AUTOMATIC_SPAWN_GUARDRAIL_ACKNOWLEDGEMENT,
  parseSpawnGuardrailAcknowledgement,
} from '../agents/shared.js';
import { resolveSpawnGuardrailRefusal } from '../agents/spawn.js';
import {
  countAdmittedWorkAgents,
  readGlobalResourceConfig,
} from '../../services/system-health-service.js';
import type { SystemHealthSnapshot } from '../../services/system-health-service.js';

const GIB = 1024 ** 3;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer _U>
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

function createHealthSnapshot(overrides: DeepPartial<SystemHealthSnapshot> = {}): SystemHealthSnapshot {
  const base: SystemHealthSnapshot = {
    severity: 'normal',
    state: 'healthy',
    updatedAt: '2026-04-27T00:00:00.000Z',
    admission: {
      admittedWorkAgentCount: 2,
    },
    summary: {
      cpuPercent: 12.5,
      loadAverage1m: 1.2,
      loadPerCore1m: 0.2,
      totalMemoryBytes: 64 * GIB,
      usedMemoryBytes: 32 * GIB,
      availableMemoryBytes: 16 * GIB,
      memoryUsedPercent: 50,
      swapTotalBytes: 8 * GIB,
      swapUsedBytes: 0,
      swapUsedPercent: 0,
      overcommitPercent: 40,
      agentCount: 3,
      workAgentCount: 2,
      planningAgentCount: 1,
      specialistSessionCount: 0,
      leakedSpecialistCount: 0,
      containerCount: 1,
      containerMemoryBytes: 2 * GIB,
      overdeckMemoryBytes: 4 * GIB,
      overdeckMemoryPercent: 6.25,
    },
    thresholds: {
      memoryAvailableWarningBytes: 4 * GIB,
      memoryAvailableCriticalBytes: 2 * GIB,
      swapUsedWarningPercent: 20,
      swapUsedCriticalPercent: 50,
      cpuLoadWarningPerCore: 1,
      cpuLoadCriticalPerCore: 1.5,
      overcommitWarningPercent: 150,
      overcommitCriticalPercent: 200,
    },
    reasons: [],
    structuredReasons: [],
    agents: [],
    leakedSpecialists: [],
    topConsumers: [],
    smeeRelay: {
      configured: false,
      running: false,
      status: 'not_configured',
      message: 'not configured',
    },
    deployStaleness: null,
    freshness: {
      status: 'fresh',
      observedAt: '2026-04-27T00:00:00.000Z',
    },
    transitionVersion: 1,
  };

  return {
    ...base,
    ...overrides,
    admission: {
      ...base.admission,
      ...overrides.admission,
    },
    summary: {
      ...base.summary,
      ...overrides.summary,
    },
    thresholds: {
      ...base.thresholds,
      ...overrides.thresholds,
    },
    reasons: overrides.reasons ?? base.reasons,
    agents: overrides.agents ?? base.agents,
    leakedSpecialists: overrides.leakedSpecialists ?? base.leakedSpecialists,
    topConsumers: overrides.topConsumers ?? base.topConsumers,
  };
}

describe('evaluateAgentStartGate', () => {
  it('blocks paused agents before dashboard start can write state', () => {
    const decision = evaluateAgentStartGate('agent-pan-1141', {
      paused: true,
      pausedReason: 'manual inspection',
      troubled: false,
      consecutiveFailures: 0,
    });

    expect(decision).toEqual({
      success: false,
      blocked: true,
      skipped: true,
      error: 'Agent agent-pan-1141 is paused (manual inspection).',
      hint: 'Run pan unpause agent-pan-1141 before starting it from the dashboard.',
      agentId: 'agent-pan-1141',
      paused: true,
      troubled: false,
    });
  });

  it('blocks troubled agents before dashboard start can write state', () => {
    const decision = evaluateAgentStartGate('agent-pan-1141', {
      paused: false,
      troubled: true,
      consecutiveFailures: 3,
    });

    expect(decision).toEqual({
      success: false,
      blocked: true,
      skipped: true,
      error: 'Agent agent-pan-1141 is troubled (3 failures).',
      hint: 'Investigate the crash cause, then run pan untroubled agent-pan-1141 before starting it from the dashboard.',
      agentId: 'agent-pan-1141',
      paused: false,
      troubled: true,
    });
  });

  it('allows starts when no persistent gate is set', () => {
    expect(evaluateAgentStartGate('agent-pan-1141', undefined)).toBeNull();
    expect(evaluateAgentStartGate('agent-pan-1141', { paused: false, troubled: false })).toBeNull();
  });
});

describe('hasActiveAgentGateOrRetry', () => {
  const now = Date.parse('2026-05-17T12:00:00.000Z');

  it('retains paused and troubled stopped agents regardless of age', () => {
    expect(hasActiveAgentGateOrRetry({ paused: true, troubled: false }, now)).toBe(true);
    expect(hasActiveAgentGateOrRetry({ paused: false, troubled: true }, now)).toBe(true);
  });

  it('retains stopped agents with a future retry backoff', () => {
    expect(hasActiveAgentGateOrRetry({
      paused: false,
      troubled: false,
      lastFailureNextRetryAt: '2026-05-17T12:01:00.000Z',
    }, now)).toBe(true);
  });

  it('does not retain stopped agents for expired or invalid retry backoff', () => {
    expect(hasActiveAgentGateOrRetry({
      paused: false,
      troubled: false,
      lastFailureNextRetryAt: '2026-05-17T11:59:00.000Z',
    }, now)).toBe(false);
    expect(hasActiveAgentGateOrRetry({
      paused: false,
      troubled: false,
      lastFailureNextRetryAt: 'not-a-date',
    }, now)).toBe(false);
  });
});

describe('countAdmittedWorkAgents', () => {
  const now = Date.parse('2026-07-16T12:00:00.000Z');

  // PAN-3917 FR-12: a candidate is a backend pane, so `status` is the pane's
  // own state — `exited`/`done` are over, and `unknown` is a pane whose agent
  // has not reported yet (what the deleted mirror called `starting`).
  it('excludes finished panes and an unreported pane past the startup grace', () => {
    expect(countAdmittedWorkAgents([
      { role: 'work', status: 'exited', startedAt: '2026-07-16T11:59:00.000Z', tmuxActive: true },
      { role: 'work', status: 'done', startedAt: '2026-07-16T11:59:00.000Z', tmuxActive: true },
      { role: 'work', status: 'unknown', startedAt: '2026-07-16T11:55:00.000Z', tmuxActive: false },
      { role: 'work', status: 'unknown', startedAt: 'not-a-date', tmuxActive: false },
    ], now)).toBe(0);
  });

  it('counts live work panes and fresh unreported starts without counting other roles', () => {
    expect(countAdmittedWorkAgents([
      { role: 'work', status: 'working', startedAt: '2026-07-16T10:00:00.000Z', tmuxActive: true },
      { role: 'work', status: 'unknown', startedAt: '2026-07-16T11:55:01.000Z', tmuxActive: false },
      { role: 'work', status: 'idle', startedAt: '2026-07-16T10:00:00.000Z', tmuxActive: true },
      { role: 'work', status: 'working', startedAt: '2026-07-16T11:59:00.000Z', tmuxActive: false },
      { role: 'plan', status: 'working', startedAt: '2026-07-16T11:59:00.000Z', tmuxActive: true },
      { role: 'review', status: 'working', startedAt: '2026-07-16T11:59:00.000Z', tmuxActive: true },
      { role: 'test', status: 'working', startedAt: '2026-07-16T11:59:00.000Z', tmuxActive: true },
      { role: 'uat', status: 'working', startedAt: '2026-07-16T11:59:00.000Z', tmuxActive: true },
      { role: 'strike', status: 'working', startedAt: '2026-07-16T11:59:00.000Z', tmuxActive: true },
    ], now)).toBe(3);
  });
});

describe('evaluateSpawnGuardrails', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await readGlobalResourceConfig();
  });

  it('fails closed when the retained health assessment is stale', () => {
    const decision = evaluateSpawnGuardrails(createHealthSnapshot({
      freshness: {
        status: 'stale',
        observedAt: '2026-04-27T00:01:00.000Z',
        reason: {
          code: 'host.sampler.collection_failed',
          domain: 'host',
          severity: 'critical',
          message: 'System health collection failed.',
        },
      },
    }));

    expect(decision).toMatchObject({
      blocked: true,
      requiresAcknowledgement: false,
      status: 503,
      error: 'System health evidence is stale: System health collection failed.',
      hint: 'Wait for a fresh system health assessment before starting this agent.',
      warnings: [{
        severity: 'critical',
        code: 'health_snapshot_unavailable',
      }],
      health: {
        freshness: {
          status: 'stale',
        },
      },
    });
  });

  it('does not block exactly at the memory threshold boundary', async () => {
    vi.stubEnv('PAN_MEMORY_WARN_GB', '2');
    vi.stubEnv('PAN_MEMORY_BLOCK_GB', '2');
    await readGlobalResourceConfig();

    const decision = evaluateSpawnGuardrails(createHealthSnapshot({
      summary: {
        availableMemoryBytes: 2 * GIB,
      },
      thresholds: {
        memoryAvailableWarningBytes: 2 * GIB,
        memoryAvailableCriticalBytes: 2 * GIB,
      },
    }));

    expect(decision.blocked).toBe(false);
    expect(decision.requiresAcknowledgement).toBe(false);
    expect(decision.warnings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'memory_pressure', severity: 'critical' })]),
    );
  });

  it('ignores the broad compatibility count when no work agents are admitted', async () => {
    vi.stubEnv('PAN_AGENT_WARN_COUNT', '5');
    vi.stubEnv('PAN_AGENT_BLOCK_COUNT', '6');
    await readGlobalResourceConfig();

    const decision = evaluateSpawnGuardrails(createHealthSnapshot({
      admission: {
        admittedWorkAgentCount: 0,
      },
      summary: {
        workAgentCount: 99,
      },
    }));

    expect(decision.blocked).toBe(false);
    expect(decision.requiresAcknowledgement).toBe(false);
    expect(decision.warnings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'agent_capacity' })]),
    );
  });

  it('returns acknowledgement-required warnings when work agent count is high but below the hard limit', async () => {
    vi.stubEnv('PAN_AGENT_WARN_COUNT', '5');
    vi.stubEnv('PAN_AGENT_BLOCK_COUNT', '6');
    await readGlobalResourceConfig();

    const decision = evaluateSpawnGuardrails(createHealthSnapshot({
      admission: {
        admittedWorkAgentCount: 5,
      },
    }));

    expect(decision.blocked).toBe(false);
    expect(decision.requiresAcknowledgement).toBe(true);
    expect(decision.status).toBe(409);
    expect(decision.hint).toBe('Acknowledge the system health warnings before starting this agent.');
    expect(decision.warnings).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'agent_capacity',
        message: 'Work agent count is high (5/6).',
      }),
    ]);
  });

  it('blocks spawns when available memory is critically low', async () => {
    vi.stubEnv('PAN_MEMORY_BLOCK_GB', '2');
    await readGlobalResourceConfig();

    const decision = evaluateSpawnGuardrails(createHealthSnapshot({
      severity: 'critical',
      summary: {
        availableMemoryBytes: Math.floor(1.5 * GIB),
      },
      reasons: ['Available RAM below critical threshold'],
    }));

    expect(decision.blocked).toBe(true);
    expect(decision.requiresAcknowledgement).toBe(false);
    expect(decision.status).toBe(429);
    expect(decision.error).toBe('Available RAM is critically low (1.5 GB).');
    expect(decision.hint).toBe('Reduce memory pressure or active work-agent count before retrying.');
    expect(decision.warnings).toEqual([
      expect.objectContaining({
        severity: 'critical',
        code: 'memory_pressure',
      }),
    ]);
  });

  it('warns instead of blocking when work agent count reaches the configured ceiling', async () => {
    vi.stubEnv('PAN_AGENT_BLOCK_COUNT', '6');
    await readGlobalResourceConfig();

    const decision = evaluateSpawnGuardrails(createHealthSnapshot({
      severity: 'critical',
      admission: {
        admittedWorkAgentCount: 6,
      },
      summary: {
        leakedSpecialistCount: 4,
      },
      leakedSpecialists: [
        { name: 'specialist-pan-1', currentIssue: 'PAN-1', reason: 'parent agent missing' },
        { name: 'specialist-pan-2', currentIssue: 'PAN-2', reason: 'parent agent missing' },
        { name: 'specialist-pan-3', currentIssue: 'PAN-3', reason: 'parent agent missing' },
        { name: 'specialist-pan-4', currentIssue: 'PAN-4', reason: 'parent agent missing' },
      ],
    }));

    expect(decision.blocked).toBe(false);
    expect(decision.requiresAcknowledgement).toBe(true);
    expect(decision.status).toBe(409);
    expect(decision.hint).toBe('Acknowledge the system health warnings before starting this agent.');
    expect(decision.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          code: 'agent_capacity',
          message: 'Work agent count is at the configured ceiling (6/6).',
        }),
        expect.objectContaining({
          severity: 'warning',
          code: 'leaked_specialists',
          message: 'Leaked specialist sessions detected: specialist-pan-1 (PAN-1), specialist-pan-2 (PAN-2), specialist-pan-3 (PAN-3), +1 more.',
        }),
      ]),
    );
  });
});

// PAN-3977: the planning auto-handoff starts work agents with nobody watching.
// Its acknowledgement covers tight RAM and a high agent count, nothing else.
describe('resolveSpawnGuardrailRefusal (POST /api/agents guardrail step)', () => {
  const automaticBody = {
    issueId: 'PAN-3977',
    role: 'work',
    startedBy: 'planning-auto-handoff',
    autoSpawnConsentRequired: true,
    guardrailAcknowledgedWarnings: AUTOMATIC_SPAWN_GUARDRAIL_ACKNOWLEDGEMENT,
  };
  const operatorBody = { issueId: 'PAN-3977', guardrailAcknowledged: true };
  const leaked = [
    { name: 'specialist-pan-1', currentIssue: 'PAN-1', reason: 'parent agent missing' },
  ];

  function refuse(body: unknown, health: SystemHealthSnapshot) {
    // Round-trip through JSON: the route sees the body the way fetch sent it.
    const parsed = JSON.parse(JSON.stringify(body)) as unknown;
    return resolveSpawnGuardrailRefusal('PAN-3977', health, parseSpawnGuardrailAcknowledgement(parsed)).refusal;
  }

  afterEach(async () => {
    vi.unstubAllEnvs();
    await readGlobalResourceConfig();
  });

  it('lets the automatic acknowledgement past tight RAM', () => {
    const health = createHealthSnapshot({ summary: { availableMemoryBytes: 3 * GIB } });

    expect(refuse({ issueId: 'PAN-3977' }, health)).toMatchObject({ status: 409 });
    expect(refuse(automaticBody, health)).toBeNull();
  });

  it('lets the automatic acknowledgement past a high agent count below the ceiling', async () => {
    vi.stubEnv('PAN_AGENT_WARN_COUNT', '5');
    vi.stubEnv('PAN_AGENT_BLOCK_COUNT', '6');
    await readGlobalResourceConfig();

    expect(refuse(automaticBody, createHealthSnapshot({ admission: { admittedWorkAgentCount: 5 } }))).toBeNull();
  });

  it('refuses the automatic acknowledgement at the agent ceiling', async () => {
    vi.stubEnv('PAN_AGENT_WARN_COUNT', '5');
    vi.stubEnv('PAN_AGENT_BLOCK_COUNT', '6');
    await readGlobalResourceConfig();
    const health = createHealthSnapshot({ admission: { admittedWorkAgentCount: 6 } });

    expect(refuse(automaticBody, health)).toMatchObject({
      status: 409,
      body: {
        success: false,
        requiresAcknowledgement: true,
        error: expect.stringContaining('Work agent count is at the configured ceiling (6/6).'),
        unacknowledgedWarnings: [expect.objectContaining({ kind: 'agent_count_ceiling' })],
      },
    });
    // The operator's confirm dialog still covers it.
    expect(refuse(operatorBody, health)).toBeNull();
  });

  it('refuses the automatic acknowledgement when leaked specialists are present', () => {
    const health = createHealthSnapshot({
      summary: { leakedSpecialistCount: 1 },
      leakedSpecialists: leaked,
    });

    expect(refuse(automaticBody, health)).toMatchObject({
      status: 409,
      body: {
        requiresAcknowledgement: true,
        unacknowledgedWarnings: [expect.objectContaining({ kind: 'leaked_specialists' })],
      },
    });
    expect(refuse(operatorBody, health)).toBeNull();
  });

  it('refuses every acknowledgement under critical RAM', () => {
    const health = createHealthSnapshot({
      severity: 'critical',
      summary: { availableMemoryBytes: Math.floor(1.5 * GIB) },
    });

    for (const body of [automaticBody, operatorBody]) {
      expect(refuse(body, health)).toMatchObject({
        status: 429,
        body: { blocked: true, error: 'Available RAM is critically low (1.5 GB).' },
      });
    }
  });

  it('ignores unknown acknowledgement kinds', () => {
    const health = createHealthSnapshot({ summary: { availableMemoryBytes: 3 * GIB } });

    expect(refuse({ guardrailAcknowledgedWarnings: ['everything', 'memory_pressure'] }, health))
      .toMatchObject({ status: 409 });
  });
});
