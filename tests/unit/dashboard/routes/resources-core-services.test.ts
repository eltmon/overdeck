import { describe, expect, it } from 'vitest';

import {
  buildCoreServices,
  type CoreServicesDeaconStatus,
  type HostProcessRecord,
} from '../../../../src/dashboard/server/routes/resources.js';

const NOW_MS = Date.parse('2026-07-07T12:00:00.000Z');

describe('core services resources payload', () => {
  it('returns dashboard event-loop p99 from the shared metrics sample and an uptime string', () => {
    const rows = buildCoreServices({
      nowMs: NOW_MS,
      eventLoopSample: {
        p50: 4.2,
        p99: 37.5,
        max: 41.1,
        unit: 'ms',
        sampledAt: '2026-07-07T11:59:30.000Z',
        windowMs: 60_000,
      },
      processInfo: {
        uptimeSeconds: 3_726,
        nodeVersion: 'v22.11.0',
        distPath: '/repo/dist/dashboard/server.js',
        cpuPercent: 12.3,
        memoryBytes: 250_000_000,
      },
      deaconStatus: deaconStatusFixture(),
    });

    expect(rows[0]).toMatchObject({
      id: 'dashboard',
      eventLoopP99Ms: 37.5,
      uptime: '1h 2m',
      nodeVersion: 'v22.11.0',
      distPath: '/repo/dist/dashboard/server.js',
      cpuPercent: 12.3,
      memoryBytes: 250_000_000,
    });
  });

  it('derives deacon last tick age and last error from deacon-lite', () => {
    const rows = buildCoreServices({
      nowMs: NOW_MS,
      processInfo: dashboardFixture(),
      eventLoopSample: eventLoopFixture(),
      deaconStatus: deaconStatusFixture({
        deaconLite: {
          running: true,
          intervalMs: 60_000,
          lastRunAt: '2026-07-07T11:58:30.000Z',
          lastRunError: 'derive failed',
        },
      }),
    });

    expect(rows[1]).toMatchObject({
      id: 'deacon',
      status: 'running',
      lastTickAgeSeconds: 90,
      lastRunError: 'derive failed',
      pid: 1234,
    });
  });

  it('returns one aggregated support-fleet row across traefik, smee, pty, and tldr processes', () => {
    const rows = buildCoreServices({
      nowMs: NOW_MS,
      processInfo: dashboardFixture(),
      eventLoopSample: eventLoopFixture(),
      deaconStatus: deaconStatusFixture(),
      supportProcesses: [
        process(10, 'traefik --configFile=traefik.yml', 1.5, 20_000_000),
        process(11, 'smee --url https://smee.io/test', 2.25, 30_000_000),
        process(12, 'node dist/dashboard/pty-supervisor.js', 3.75, 40_000_000),
        process(13, 'tldr daemon', 4, 50_000_000),
        process(14, 'node unrelated-worker.js', 100, 900_000_000),
      ],
    });

    expect(rows[2]).toMatchObject({
      id: 'support-fleet',
      status: 'running',
      memberCount: 4,
      cpuPercent: 11.5,
      memoryBytes: 140_000_000,
    });
    expect(rows[2].members).toEqual([
      'traefik --configFile=traefik.yml',
      'smee --url https://smee.io/test',
      'node dist/dashboard/pty-supervisor.js',
      'tldr daemon',
    ]);
  });
});

function dashboardFixture() {
  return {
    uptimeSeconds: 120,
    nodeVersion: 'v22.11.0',
    distPath: '/repo/dist/dashboard/server.js',
    cpuPercent: 1,
    memoryBytes: 100_000_000,
  };
}

function eventLoopFixture() {
  return {
    p50: 1,
    p99: 2,
    max: 3,
    unit: 'ms' as const,
    sampledAt: '2026-07-07T11:59:30.000Z',
    windowMs: 60_000,
  };
}

function deaconStatusFixture(
  overrides: Partial<CoreServicesDeaconStatus> = {},
): CoreServicesDeaconStatus {
  // PAN-3917 (W4): deacon-lite keeps no patrol ledger — its in-memory
  // running/lastRunAt/lastRunError is the whole status.
  return {
    isRunning: true,
    pid: 1234,
    deaconLite: {
      running: true,
      intervalMs: 60_000,
      lastRunAt: '2026-07-07T11:59:00.000Z',
      lastRunError: null,
    },
    ...overrides,
  };
}

function process(
  pid: number,
  command: string,
  cpuPercent: number,
  memoryBytes: number,
): HostProcessRecord {
  return { pid, ppid: 1, command, cpuPercent, memoryBytes };
}
