import { describe, expect, it } from 'vitest';

import {
  enrichContainersWithLimits,
  getMemoryLimitLevel,
  type ContainerLimitInput,
  type ContainerOomEvent,
} from '../../../../src/dashboard/server/routes/resources.js';

const NOW_MS = Date.parse('2026-07-07T12:00:00.000Z');

describe('container limit resources payload', () => {
  it('returns 95 percent-of-limit and red severity for a 3.8 GB / 4 GB fixture', () => {
    const [row] = enrichContainersWithLimits([
      container({
        memoryUsage: 3.8 * 1024 ** 3,
        memoryLimit: 4 * 1024 ** 3,
      }),
    ], { nowMs: NOW_MS });

    expect(row).toMatchObject({
      memLimitBytes: 4 * 1024 ** 3,
      memPercentOfLimit: 95,
      oomKills24h: 0,
    });
    expect(getMemoryLimitLevel(row.memPercentOfLimit)).toBe('red');
  });

  it('counts only OOM kills for the same container within the last 24 hours', () => {
    const [row] = enrichContainersWithLimits([
      container({ id: 'abc123456789', name: 'server' }),
    ], {
      nowMs: NOW_MS,
      oomEvents: [
        oom({ containerId: 'abc123', hoursAgo: 1 }),
        oom({ containerName: 'server', hoursAgo: 23 }),
        oom({ containerId: 'abc123', hoursAgo: 25 }),
        oom({ containerName: 'other', hoursAgo: 1 }),
      ],
    });

    expect(row.oomKills24h).toBe(2);
  });

  it('returns null limit and no percent-of-limit when Docker reports no memory limit', () => {
    const [row] = enrichContainersWithLimits([
      container({
        memoryUsage: 512 * 1024 ** 2,
        memoryLimit: 0,
      }),
    ], { nowMs: NOW_MS });

    expect(row.memLimitBytes).toBeNull();
    expect(row.memPercentOfLimit).toBeUndefined();
    expect(row.memoryUsage).toBe(512 * 1024 ** 2);
  });

  it('derives the compose file hint from Docker compose labels', () => {
    const [row] = enrichContainersWithLimits([
      container({
        labels: {
          'com.docker.compose.project.config_files': '/repo/docker-compose.yml,/repo/docker-compose.override.yml',
        },
      }),
    ], { nowMs: NOW_MS });

    expect(row.composeFile).toBe('/repo/docker-compose.yml');
  });
});

function container(overrides: Partial<ContainerLimitInput> = {}): ContainerLimitInput {
  return {
    id: 'abc123',
    name: 'server',
    memoryUsage: 0,
    memoryLimit: 1024 ** 3,
    ...overrides,
  };
}

function oom(
  overrides: Partial<ContainerOomEvent> & { hoursAgo: number },
): ContainerOomEvent {
  return {
    timestamp: new Date(NOW_MS - overrides.hoursAgo * 60 * 60 * 1000).toISOString(),
    containerId: overrides.containerId,
    containerName: overrides.containerName,
  };
}
