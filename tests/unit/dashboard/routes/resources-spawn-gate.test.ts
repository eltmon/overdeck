import type { SystemHealthSnapshot as AcceptedSystemHealthSnapshot } from '@overdeck/contracts';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getResourcesEffect,
  mapSpawnGateDecision,
  resetSpawnGateHealthSnapshotReadersForTests,
  setSpawnGateHealthSnapshotReadersForTests,
} from '../../../../src/dashboard/server/routes/resources.js';
import { spawnGuardrailResourcesHint } from '../../../../src/dashboard/server/routes/agents/spawn.js';
import type { SpawnGuardrailDecision } from '../../../../src/dashboard/server/routes/agents/shared.js';
import type { SystemHealthSnapshot as CompatibilitySystemHealthSnapshot } from '../../../../src/dashboard/server/services/system-health-service.js';

const GIB = 1024 ** 3;

afterEach(() => {
  resetSpawnGateHealthSnapshotReadersForTests();
});

describe('resources spawn gate payload', () => {
  it('maps a clean spawn guardrail decision to the accepted open admission state', () => {
    expect(mapSpawnGateDecision(
      decision({ status: 200 }),
      acceptedHealthFixture(),
    )).toMatchObject({
      state: 'open',
      reason: '',
      reasons: [],
      admittedWorkAgentCount: 1,
    });
  });

  it('keeps soft admission separate from healthy host pressure', () => {
    const accepted = acceptedHealthFixture({
      admission: {
        state: 'soft',
        availableMemoryBytes: 6 * GIB,
        admittedWorkAgentCount: 7,
        reasons: [{
          code: 'admission.memory.headroom.soft',
          domain: 'admission',
          severity: 'warning',
          message: 'Available RAM is tight (6 GB).',
        }],
      },
    });

    expect(accepted.host.state).toBe('healthy');
    expect(mapSpawnGateDecision(decision({ status: 200 }), accepted)).toMatchObject({
      state: 'soft',
      reason: 'Available RAM is tight (6 GB).',
      admittedWorkAgentCount: 7,
      reasons: [{
        code: 'admission.memory.headroom.soft',
        domain: 'admission',
      }],
    });
  });

  it('projects the same accepted host and admission evidence in GET /api/resources', async () => {
    const accepted = acceptedHealthFixture({
      host: {
        state: 'healthy',
        platform: 'linux',
        reasons: [],
        metrics: {
          ...acceptedHealthFixture().host.metrics,
          cpuPercent: 42.4,
          loadAverage1m: 1.1,
          usedMemoryBytes: 10 * GIB,
          availableMemoryBytes: 6 * GIB,
          swapUsedBytes: 3 * GIB,
          swapTotalBytes: 8 * GIB,
        },
      },
      admission: {
        state: 'soft',
        availableMemoryBytes: 6 * GIB,
        admittedWorkAgentCount: 4,
        reasons: [{
          code: 'admission.memory.headroom.soft',
          domain: 'admission',
          severity: 'warning',
          message: 'Available RAM is tight (6 GB).',
        }],
      },
    });
    setSpawnGateHealthSnapshotReadersForTests({
      accepted: async () => accepted,
      compatibility: async () => compatibilityHealthFixture(),
    });

    const response = await Effect.runPromise(getResourcesEffect());
    const body = await readJsonBody(response);

    expect(body.hostVitals).toMatchObject({
      cpu: { percent: 42.4, load: [1.1, null, null] },
      mem: {
        usedBytes: 10 * GIB,
        availableBytes: 6 * GIB,
        swapUsedBytes: 3 * GIB,
        swapTotalBytes: 8 * GIB,
      },
    });
    expect(body.spawnGate).toMatchObject({
      state: 'soft',
      reason: 'Available RAM is tight (6 GB).',
      admittedWorkAgentCount: 4,
      reasons: [{ code: 'admission.memory.headroom.soft' }],
    });
  });

  it('does not let accepted display state disable a blocking enforcement decision', () => {
    const result = mapSpawnGateDecision(decision({
      blocked: true,
      status: 429,
      error: 'Available RAM is critically low.',
      warnings: [{
        severity: 'critical',
        code: 'memory_pressure',
        message: 'Available RAM is critically low.',
      }],
    }), acceptedHealthFixture());

    expect(result).toMatchObject({
      state: 'blocked',
      reason: 'Available RAM is critically low.',
      pressure: 100,
      reasons: [{
        domain: 'admission',
        severity: 'critical',
        code: 'memory_pressure',
      }],
      warnings: [{
        severity: 'critical',
        code: 'memory_pressure',
      }],
    });
  });

  it('continues enforcing canonical memory limits with structured reasons', async () => {
    const compatibility = compatibilityHealthFixture();
    compatibility.summary.availableMemoryBytes = GIB;
    setSpawnGateHealthSnapshotReadersForTests({
      accepted: async () => acceptedHealthFixture(),
      compatibility: async () => compatibility,
    });

    const response = await Effect.runPromise(getResourcesEffect());
    const body = await readJsonBody(response);

    expect(body.spawnGate).toMatchObject({
      state: 'blocked',
      reasons: [{
        domain: 'admission',
        severity: 'critical',
        code: 'memory_pressure',
      }],
      warnings: [{
        severity: 'critical',
        code: 'memory_pressure',
      }],
    });
  });

  it('returns explicit unavailable admission evidence when accepted health cannot be read', async () => {
    setSpawnGateHealthSnapshotReadersForTests({
      accepted: async () => {
        throw new Error('accepted snapshot unavailable');
      },
      compatibility: async () => compatibilityHealthFixture(),
    });

    const response = await Effect.runPromise(getResourcesEffect());
    const body = await readJsonBody(response);

    expect(body.spawnGate).toEqual({
      state: 'unavailable',
      reason: 'Spawn gate health is unavailable.',
      reasons: [{
        code: 'admission.snapshot.unavailable',
        domain: 'admission',
        severity: 'critical',
        message: 'Spawn gate health is unavailable.',
      }],
      admittedWorkAgentCount: null,
      warnings: [],
      pressure: 0,
      stale: true,
    });
    expect(body.hostVitals).toMatchObject({
      cpu: { percent: null, load: [null, null, null] },
      mem: {
        usedBytes: null,
        availableBytes: null,
        swapUsedBytes: null,
        swapTotalBytes: null,
      },
    });
  });

  it('points acknowledgement-required spawn failures at the Machine Room resources view', () => {
    expect(spawnGuardrailResourcesHint('Acknowledge warnings before starting.')).toContain('/resources');
  });
});

async function readJsonBody(response: Awaited<ReturnType<typeof Effect.runPromise>>) {
  const raw = response.body as { body: Uint8Array } | null;
  const text = raw?.body ? new TextDecoder().decode(raw.body) : '{}';
  return JSON.parse(text) as Record<string, any>;
}

function decision(overrides: Partial<SpawnGuardrailDecision>): SpawnGuardrailDecision {
  return {
    blocked: false,
    requiresAcknowledgement: false,
    status: 200,
    warnings: [],
    health: {
      severity: 'normal',
      summary: {
        cpuPercent: 0,
        loadAverage1m: 0,
        loadPerCore1m: 0,
        availableMemoryBytes: 8 * GIB,
        totalMemoryBytes: 16 * GIB,
        usedMemoryBytes: 8 * GIB,
        memoryUsedPercent: 50,
        swapTotalBytes: 0,
        swapUsedBytes: 0,
        swapUsedPercent: 0,
        overcommitPercent: 0,
        agentCount: 1,
        workAgentCount: 1,
        planningAgentCount: 0,
        specialistSessionCount: 0,
        leakedSpecialistCount: 0,
        containerCount: 0,
        containerMemoryBytes: 0,
        overdeckMemoryBytes: 0,
        overdeckMemoryPercent: 0,
      },
      reasons: [],
      leakedSpecialists: [],
    },
    ...overrides,
  };
}

function acceptedHealthFixture(
  overrides: Partial<AcceptedSystemHealthSnapshot> = {},
): AcceptedSystemHealthSnapshot {
  return {
    version: 2,
    state: 'healthy',
    updatedAt: '2026-07-17T04:00:00.000Z',
    nextPollMs: 15_000,
    host: {
      state: 'healthy',
      platform: 'linux',
      reasons: [],
      metrics: {
        cpuPercent: 12,
        loadAverage1m: 1.2,
        loadPerCore1m: 0.15,
        totalMemoryBytes: 16 * GIB,
        usedMemoryBytes: 8 * GIB,
        availableMemoryBytes: 8 * GIB,
        memoryUsedPercent: 50,
        memoryPressureSomeAvg10: 0,
        memoryPressureFullAvg10: 0,
        memoryPressureFreePercent: null,
        swapTotalBytes: 8 * GIB,
        swapUsedBytes: 0,
        swapUsedPercent: 0,
        swapActivityBytesPerMinute: 0,
        committedMemoryBytes: 8 * GIB,
        commitLimitBytes: 24 * GIB,
        virtualCommitmentPercent: 33.3,
      },
    },
    admission: {
      state: 'open',
      availableMemoryBytes: 8 * GIB,
      admittedWorkAgentCount: 1,
      reasons: [],
    },
    agents: [],
    services: [],
    topConsumers: [],
    summary: compatibilitySummary(),
    ...overrides,
  };
}

function compatibilityHealthFixture(): CompatibilitySystemHealthSnapshot {
  return {
    severity: 'normal',
    state: 'healthy',
    updatedAt: '2026-07-17T04:00:00.000Z',
    summary: compatibilitySummary(),
    admission: { admittedWorkAgentCount: 1 },
    thresholds: {
      memoryAvailableWarningBytes: 4 * GIB,
      memoryAvailableCriticalBytes: 2 * GIB,
      swapUsedWarningPercent: 40,
      swapUsedCriticalPercent: 70,
      cpuLoadWarningPerCore: 2,
      cpuLoadCriticalPerCore: 4,
      overcommitWarningPercent: 80,
      overcommitCriticalPercent: 95,
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
    freshness: {
      stale: false,
      sampledAtMs: Date.parse('2026-07-17T04:00:00.000Z'),
      ageMs: 0,
    },
    transitionVersion: 1,
  };
}

function compatibilitySummary() {
  return {
    cpuPercent: 12,
    loadAverage1m: 1.2,
    loadPerCore1m: 0.15,
    availableMemoryBytes: 8 * GIB,
    totalMemoryBytes: 16 * GIB,
    usedMemoryBytes: 8 * GIB,
    memoryUsedPercent: 50,
    swapTotalBytes: 8 * GIB,
    swapUsedBytes: 0,
    swapUsedPercent: 0,
    committedMemoryBytes: 8 * GIB,
    commitLimitBytes: 24 * GIB,
    overcommitPercent: 33.3,
    agentCount: 1,
    workAgentCount: 1,
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
      status: 'not_configured' as const,
      message: 'not configured',
    },
  };
}
