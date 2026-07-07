import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getResourcesEffect,
  mapSpawnGateDecision,
  resetSpawnGateHealthSnapshotReaderForTests,
  setSpawnGateHealthSnapshotReaderForTests,
} from '../../../../src/dashboard/server/routes/resources.js';
import { spawnGuardrailResourcesHint } from '../../../../src/dashboard/server/routes/agents/spawn.js';
import type { SpawnGuardrailDecision } from '../../../../src/dashboard/server/routes/agents/shared.js';
import type { SystemHealthSnapshot } from '../../../../src/dashboard/server/services/system-health-service.js';

afterEach(() => {
  resetSpawnGateHealthSnapshotReaderForTests();
});

describe('resources spawn gate payload', () => {
  it('maps a clean spawn guardrail decision to OPEN', () => {
    expect(mapSpawnGateDecision(decision({ status: 200 }))).toMatchObject({
      state: 'OPEN',
      reason: '',
    });
  });

  it('maps acknowledgement-required warnings to SOFT with the warning reason', () => {
    expect(mapSpawnGateDecision(decision({
      requiresAcknowledgement: true,
      status: 409,
      warnings: [{ severity: 'warning', code: 'agent_capacity', message: 'Work agent count is high.' }],
    }))).toMatchObject({
      state: 'SOFT',
      reason: 'Work agent count is high.',
    });
  });

  it('includes SOFT spawnGate state and warning reason in GET /api/resources', async () => {
    setSpawnGateHealthSnapshotReaderForTests(async () => healthFixture({
      availableMemoryBytes: 6 * 1024 ** 3,
      memoryAvailableWarningBytes: 8 * 1024 ** 3,
      memoryAvailableCriticalBytes: 2 * 1024 ** 3,
    }));

    const response = await Effect.runPromise(getResourcesEffect());
    const body = await readJsonBody(response);

    expect(body.spawnGate).toMatchObject({
      state: 'SOFT',
      reason: 'Available RAM is tight (6 GB).',
    });
  });

  it('maps blocked guardrails to BLOCKED with the error reason', () => {
    expect(mapSpawnGateDecision(decision({
      blocked: true,
      status: 429,
      error: 'Available RAM is critically low.',
      warnings: [{ severity: 'critical', code: 'memory_pressure', message: 'Available RAM is critically low.' }],
    }))).toMatchObject({
      state: 'BLOCKED',
      reason: 'Available RAM is critically low.',
      pressure: 100,
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
        availableMemoryBytes: 8 * 1024 ** 3,
        totalMemoryBytes: 16 * 1024 ** 3,
        usedMemoryBytes: 8 * 1024 ** 3,
        memoryUsedPercent: 50,
        swapTotalBytes: 0,
        swapUsedBytes: 0,
        swapUsedPercent: 0,
        overcommitPercent: 0,
        agentCount: 0,
        workAgentCount: 0,
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

function healthFixture(overrides: {
  availableMemoryBytes: number;
  memoryAvailableWarningBytes: number;
  memoryAvailableCriticalBytes: number;
}): SystemHealthSnapshot {
  return {
    severity: 'warning',
    updatedAt: '2026-07-07T12:00:00.000Z',
    summary: {
      cpuPercent: 0,
      loadAverage1m: 0,
      loadPerCore1m: 0,
      availableMemoryBytes: overrides.availableMemoryBytes,
      totalMemoryBytes: 16 * 1024 ** 3,
      usedMemoryBytes: 10 * 1024 ** 3,
      memoryUsedPercent: 62.5,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      swapUsedPercent: 0,
      overcommitPercent: 0,
      agentCount: 0,
      workAgentCount: 0,
      planningAgentCount: 0,
      specialistSessionCount: 0,
      leakedSpecialistCount: 0,
      containerCount: 0,
      containerMemoryBytes: 0,
      overdeckMemoryBytes: 0,
      overdeckMemoryPercent: 0,
    },
    thresholds: {
      memoryAvailableWarningBytes: overrides.memoryAvailableWarningBytes,
      memoryAvailableCriticalBytes: overrides.memoryAvailableCriticalBytes,
      swapUsedWarningPercent: 40,
      swapUsedCriticalPercent: 70,
      cpuLoadWarningPerCore: 2,
      cpuLoadCriticalPerCore: 4,
      overcommitWarningPercent: 80,
      overcommitCriticalPercent: 95,
    },
    reasons: ['Available RAM is tight.'],
    agents: [],
    leakedSpecialists: [],
    topConsumers: [],
    smeeRelay: {
      configured: false,
      running: false,
      status: 'not_configured',
      message: 'not configured',
    },
  };
}
