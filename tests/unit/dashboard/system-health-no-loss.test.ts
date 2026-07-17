import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SystemHealthThresholds } from '../../../src/lib/system-health/config.js';
import { evaluateHostPressure } from '../../../src/lib/system-health/evaluate.js';
import {
  available,
  unavailable,
  type HostMetricSample,
} from '../../../src/lib/system-health/types.js';
import {
  HEALTH_NO_LOSS_MATRIX,
  NO_LOSS_MATRIX,
} from '../lib/overdeck/no-loss-matrix.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const GIB = 1024 ** 3;

const REQUIRED_SURFACES = [
  'Header health pill metric',
  'CPU and load',
  'Memory totals',
  'Swap fields',
  'Committed-memory diagnostic',
  'Memory attributions',
  'Role counts',
  'Webhook state',
  'Kill action',
  'Remove action',
  'Leaked-focus supersession',
  'Transition event',
  'GET /api/system/health',
  'GET /api/godview/system-health',
  'GET /api/health/agents',
  'Resources host vitals',
  'Spawn gate',
  'Capacity guardrail',
  'Summary cards',
  'Deacon section',
  'TLDR section',
  'pan doctor',
] as const;

const thresholds: SystemHealthThresholds = {
  memoryAvailableWarningBytes: 4 * GIB,
  memoryAvailableCriticalBytes: 2 * GIB,
  swapUsedWarningPercent: 20,
  swapUsedCriticalPercent: 50,
  cpuLoadWarningPerCore: 1,
  cpuLoadCriticalPerCore: 1.5,
  overcommitWarningPercent: 150,
  overcommitCriticalPercent: 200,
};

function quietHostWithHistoricalDiagnostics(): HostMetricSample {
  return {
    platform: 'linux',
    sampledAtMs: 1,
    cpuPercent: available(25),
    loadAverage1m: available(2),
    loadPerCore1m: available(0.5),
    totalMemoryBytes: available(16 * GIB),
    usedMemoryBytes: available(8 * GIB),
    availableMemoryBytes: available(8 * GIB),
    memoryUsedPercent: available(50),
    memoryPressureSomeAvg10: available(0),
    memoryPressureFullAvg10: available(0),
    memoryPressureFreePercent: unavailable('not a macOS sample'),
    swapTotalBytes: available(4 * GIB),
    swapUsedBytes: available(2 * GIB),
    swapUsedPercent: available(50),
    swapActivityBytesPerMinute: available(0),
    committedMemoryBytes: available(20 * GIB),
    commitLimitBytes: available(16 * GIB),
    virtualCommitmentPercent: available(125),
    counters: { cpu: null, swap: null },
  };
}

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('system health no-loss audit', () => {
  it('assigns every legacy health surface exactly one concrete V2 home or supersession', () => {
    for (const surface of REQUIRED_SURFACES) {
      const entries = HEALTH_NO_LOSS_MATRIX.filter((entry) => entry.surface === surface);
      expect(entries, `Missing health no-loss disposition: ${surface}`).toHaveLength(1);
      expect(
        entries[0]?.target.trim(),
        `Blank health no-loss destination: ${surface}`,
      ).not.toBe('');
    }

    const unexpected = HEALTH_NO_LOSS_MATRIX
      .map((entry) => entry.surface)
      .filter((surface) => !REQUIRED_SURFACES.includes(surface as typeof REQUIRED_SURFACES[number]));
    expect(unexpected, `Unexpected health no-loss surfaces: ${unexpected.join(', ')}`).toEqual([]);

    const superseded = HEALTH_NO_LOSS_MATRIX.filter((entry) => entry.disposition === 'SUPERSEDED');
    expect(superseded).toEqual([
      expect.objectContaining({
        surface: 'Leaked-focus supersession',
        target: expect.stringMatching(/Show all restores the complete top-consumer list/),
      }),
    ]);
  });

  it('retains every compatibility route and legacy summary projection for the compatibility cycle', () => {
    const compatibilityRoutes = [
      'GET /api/system/health',
      'GET /api/godview/system-health',
      'GET /api/health/agents',
    ] as const;

    for (const route of compatibilityRoutes) {
      expect(
        NO_LOSS_MATRIX.some((entry) => entry.surface === route),
        `Missing remodel compatibility route: ${route}`,
      ).toBe(true);
    }

    const routeSource = source('src/dashboard/server/routes/misc/health.ts');
    for (const route of compatibilityRoutes) {
      expect(routeSource, `Missing live compatibility route: ${route}`).toContain(route.slice(4));
    }

    const compatibilitySource = source('packages/contracts/src/system-health.ts');
    for (const field of [
      'cpuPercent',
      'loadAverage1m',
      'loadPerCore1m',
      'totalMemoryBytes',
      'usedMemoryBytes',
      'availableMemoryBytes',
      'memoryUsedPercent',
      'swapTotalBytes',
      'swapUsedBytes',
      'swapUsedPercent',
      'committedMemoryBytes',
      'commitLimitBytes',
      'overcommitPercent',
      'agentCount',
      'workAgentCount',
      'planningAgentCount',
      'specialistSessionCount',
      'leakedSpecialistCount',
      'containerCount',
      'containerMemoryBytes',
      'overdeckMemoryBytes',
      'overdeckMemoryPercent',
      'smeeRelay',
    ]) {
      expect(
        compatibilitySource,
        `Missing legacy system-health summary field: ${field}`,
      ).toContain(`${field}:`);
    }
  });

  it('keeps Resources projections and pan doctor in their distinct V2 homes', () => {
    const hostVitalsSource = source('src/dashboard/server/routes/resources/host-vitals.ts');
    expect(hostVitalsSource, 'Resources host vitals no longer accepts V2 health evidence').toContain('SystemHealthSnapshot');
    expect(hostVitalsSource, 'Resources host vitals projection is missing').toContain('buildHostVitalsSnapshot');

    const spawnGateSource = source('src/dashboard/server/routes/resources/spawn-gate.ts');
    expect(spawnGateSource, 'Resources spawn gate projection is missing').toContain('mapSpawnGateDecision');
    expect(spawnGateSource, 'Resources accepted health evidence is missing').toContain('getResourcesHealthEvidenceEffect');
    expect(spawnGateSource, 'Resources capacity guardrail projection is missing').toContain('getSpawnGatePayloadEffect');

    const doctorSource = source('src/cli/commands/doctor.ts');
    expect(doctorSource, 'pan doctor lost dependency checks').toContain('checkCommand');
    expect(doctorSource, 'pan doctor lost directory checks').toContain('checkDirectory');
    expect(doctorSource, 'pan doctor lost state-worktree checks').toContain('checkStateWorktrees');
    expect(
      doctorSource,
      'pan doctor must remain independent from the live accepted V2 snapshot',
    ).not.toContain('getAcceptedSystemHealthSnapshot');
  });

  it('keeps historical swap and commitment visible as diagnostics without elevating accepted severity', () => {
    const result = evaluateHostPressure(quietHostWithHistoricalDiagnostics(), thresholds);

    expect(result.state).toBe('healthy');
    expect(result.admission.state).toBe('open');
    expect(result.reasons.filter((reason) => reason.severity !== 'info')).toEqual([]);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'host.diagnostic.swap_occupancy',
        severity: 'info',
        observed: 50,
      }),
      expect.objectContaining({
        code: 'host.diagnostic.virtual_commitment',
        severity: 'info',
        observed: 125,
      }),
    ]));

    const pillSource = source('src/dashboard/frontend/src/components/SystemHealthPill.tsx');
    expect(pillSource, 'Swap diagnostics disappeared from the header health panel').toContain('metrics.swapUsedPercent');
    expect(pillSource, 'Commitment diagnostics disappeared from the header health panel').toContain('metrics.virtualCommitmentPercent');
  });
});
