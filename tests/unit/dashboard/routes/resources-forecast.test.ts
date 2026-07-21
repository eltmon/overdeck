import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildCapacityForecast,
  persistStackForecastPeak,
  recordStackForecastSample,
  resetCapacityForecastForTests,
  setForecastStateFileForTests,
  type HostVitalsSnapshot,
  type ResourceStack,
} from '../../../../src/dashboard/server/routes/resources.js';

afterEach(() => {
  resetCapacityForecastForTests();
});

describe('capacity forecast resources payload', () => {
  it('persists a stopped stack peak and predicts from its last run', () => {
    useTempForecastStore();
    const running = stack('PAN-1', { status: 'running', memoryBytes: 3 * 1024 ** 3, cpuPercent: 18 });
    recordStackForecastSample([running]);
    persistStackForecastPeak(stack('PAN-1', { status: 'stopped' }));

    const forecast = buildCapacityForecast([stack('PAN-1', { status: 'stopped' })], { hostVitals: hostVitals() });

    expect(forecast.stacks[0]).toMatchObject({
      stackId: 'PAN-1',
      predictedRamBytes: 3 * 1024 ** 3,
      predictedLoad: 18,
      approximate: true,
      source: 'last-run-peak',
    });
  });

  it('uses the fleet median peak for stacks with no recorded history', () => {
    useTempForecastStore();
    for (const [id, memoryBytes] of [['PAN-1', 1], ['PAN-2', 3], ['PAN-3', 5]] as const) {
      persistStackForecastPeak(stack(id, { status: 'stopped', memoryBytes: memoryBytes * 1024 ** 3 }));
    }

    const forecast = buildCapacityForecast([stack('PAN-NEW', { status: 'stopped' })], { hostVitals: hostVitals() });

    expect(forecast.stacks[0]).toMatchObject({
      stackId: 'PAN-NEW',
      predictedRamBytes: 3 * 1024 ** 3,
      source: 'fleet-median',
    });
  });

  it('returns headroom from hostVitals free RAM and CPU load headroom', () => {
    const forecast = buildCapacityForecast([], {
      hostVitals: hostVitals({ availableBytes: 7 * 1024 ** 3, cpuPercent: 42 }),
    });

    expect(forecast.headroom).toEqual({
      freeRamBytes: 7 * 1024 ** 3,
      loadHeadroom: 58,
    });
  });
});

function useTempForecastStore() {
  setForecastStateFileForTests(join(mkdtempSync(join(tmpdir(), 'forecast-test-')), 'peaks.json'));
}

function stack(id: string, options: { status: 'running' | 'stopped'; memoryBytes?: number; cpuPercent?: number }): ResourceStack {
  return {
    id,
    issueId: id,
    issueTitle: `${id} stack`,
    composeProject: `feature-${id.toLowerCase()}`,
    serviceCount: 1,
    services: [{
      id: `${id}-api`,
      name: `${id.toLowerCase()}-api`,
      cpuPercent: options.cpuPercent ?? 1,
      memoryUsage: options.memoryBytes ?? 512 * 1024 ** 2,
      memoryLimit: 4 * 1024 ** 3,
      status: options.status,
    }],
    aggregates: {
      cpuPercent: options.cpuPercent ?? 1,
      memoryBytes: options.memoryBytes ?? 512 * 1024 ** 2,
      diskBytes: 0,
    },
    phase: 'work',
  };
}

function hostVitals(overrides: { availableBytes?: number; cpuPercent?: number } = {}): HostVitalsSnapshot {
  return {
    stale: false,
    cpu: { percent: overrides.cpuPercent ?? 0, load: [0, 0, 0], spark: [] },
    mem: { usedBytes: 1, availableBytes: overrides.availableBytes ?? 1, swapUsedBytes: 0, swapTotalBytes: 0 },
    disk: { usedBytes: 0, freeBytes: 0, reclaimableBytes: 0 },
    docker: { containers: 0, running: 0, stacks: 0, networks: 0, networkPool: { used: 0, total: 31 }, stale: false },
    agents: { sessions: 0, active: 0, idleOver15m: 0, burnUsdPerHour: 0, hypotheticalUsdPerHour: 0, totalUsd: 0 },
  };
}
