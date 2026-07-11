import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildReclaimPayload,
  deleteResourceVenvEffect,
  getResourcesEffect,
  resetCurrentDockerStatsReaderForTests,
  resetReclaimForTests,
  resetResourceStackReviewStatusReaderForTests,
  resetSpawnGateHealthSnapshotReaderForTests,
  setCurrentDockerStatsReaderForTests,
  setReclaimIssueClosedReaderForTests,
  setReclaimProjectRootForTests,
  setReclaimVenvCandidatesForTests,
  setReclaimVenvDeleteForTests,
  setResourceStackReviewStatusReaderForTests,
  setSpawnGateHealthSnapshotReaderForTests,
  type ResourceStack,
} from '../../../../src/dashboard/server/routes/resources.js';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';
import type { SystemHealthSnapshot } from '../../../../src/dashboard/server/services/system-health-service.js';

afterEach(() => {
  resetCurrentDockerStatsReaderForTests();
  resetResourceStackReviewStatusReaderForTests();
  resetSpawnGateHealthSnapshotReaderForTests();
  resetReclaimForTests();
});

describe('resources reclaim payload', () => {
  it('returns a RAM and disk reclaim candidate for a merged stack with no live agent', async () => {
    setMergedReviewStatus();
    setCurrentDockerStatsReaderForTests(() => [container('api', { memoryUsage: 2 * 1024 ** 3 })]);
    setSpawnGateHealthSnapshotReaderForTests(async () => healthFixture());

    const body = await getResourcesJson();

    expect(body.reclaimCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'stack',
        issueId: 'MIN-857',
        ramBytes: 2 * 1024 ** 3,
      }),
    ]));
  });

  it('excludes a merged stack when a live agent references the issue', () => {
    const payload = buildReclaimPayload([stack()], [{ issueId: 'MIN-857', hasLiveTmuxSession: true }]);

    expect(payload.reclaimCandidates).toHaveLength(0);
  });

  it('returns venv candidates only for closed issues and deletes only after closure validation', async () => {
    const deleted: string[] = [];
    setReclaimIssueClosedReaderForTests((issueId) => issueId === 'MIN-857');
    setReclaimVenvCandidatesForTests([{ issueId: 'MIN-857', path: '/unused/.venv', diskBytes: 2 * 1024 ** 3 }]);
    setReclaimProjectRootForTests('/repo');
    setReclaimVenvDeleteForTests(async (path) => { deleted.push(path); });

    const payload = buildReclaimPayload([], []);
    expect(payload.reclaimCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'venv', issueId: 'MIN-857', diskBytes: 2 * 1024 ** 3 }),
    ]));

    const ok = await Effect.runPromise(deleteResourceVenvEffect('min-857'));
    expect(await readJsonBody(ok)).toMatchObject({ ok: true, issueId: 'MIN-857' });
    expect(deleted).toEqual(['/repo/workspaces/feature-min-857/.venv']);

    const refused = await Effect.runPromise(deleteResourceVenvEffect('min-999'));
    expect(refused.status).toBe(409);
  });

  it('returns reclaim totals and mirrors disk total into hostVitals.disk.reclaimableBytes', async () => {
    setMergedReviewStatus();
    setCurrentDockerStatsReaderForTests(() => [container('api', { memoryUsage: 1 })]);
    setSpawnGateHealthSnapshotReaderForTests(async () => healthFixture());

    const body = await getResourcesJson();

    expect(body.reclaimTotals.diskBytes).toBe(body.hostVitals.disk.reclaimableBytes);
  });
});

async function getResourcesJson(): Promise<Record<string, any>> {
  const response = await Effect.runPromise(getResourcesEffect());
  return readJsonBody(response);
}

async function readJsonBody(response: Awaited<ReturnType<typeof Effect.runPromise>>) {
  const raw = response.body as { body: Uint8Array } | null;
  const text = raw?.body ? new TextDecoder().decode(raw.body) : '{}';
  return JSON.parse(text) as Record<string, any>;
}

function setMergedReviewStatus() {
  setResourceStackReviewStatusReaderForTests((issueId) => issueId === 'MIN-857'
    ? reviewStatus({ issueId, mergeStatus: 'merged' })
    : null);
}

function stack(): ResourceStack {
  return {
    id: 'MIN-857',
    issueId: 'MIN-857',
    issueTitle: 'MIN-857',
    composeProject: 'myn-feature-min-857',
    serviceCount: 1,
    services: [],
    aggregates: { cpuPercent: 1, memoryBytes: 2, diskBytes: 3 },
    phase: 'merged',
  };
}

function container(service: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `container-${service}`,
    name: `myn-feature-min-857-${service}-1`,
    cpuPercent: 1,
    memoryUsage: 100,
    memoryLimit: 1024,
    memoryPercent: 10,
    networkIn: 0,
    networkOut: 0,
    status: 'running',
    labels: {
      'com.docker.compose.project': 'myn-feature-min-857',
      'com.docker.compose.service': service,
    },
    ...overrides,
  };
}

function reviewStatus(overrides: Partial<ReviewStatus>): ReviewStatus {
  return {
    issueId: 'MIN-857',
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    updatedAt: '2026-07-07T12:00:00.000Z',
    readyForMerge: false,
    ...overrides,
  };
}

function healthFixture(): SystemHealthSnapshot {
  return {
    severity: 'normal',
    updatedAt: '2026-07-07T12:00:00.000Z',
    summary: {
      cpuPercent: 0,
      loadAverage1m: 0,
      loadPerCore1m: 0,
      totalMemoryBytes: 16 * 1024 ** 3,
      usedMemoryBytes: 8 * 1024 ** 3,
      availableMemoryBytes: 8 * 1024 ** 3,
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
    thresholds: {
      memoryAvailableWarningBytes: 4 * 1024 ** 3,
      memoryAvailableCriticalBytes: 2 * 1024 ** 3,
      swapUsedWarningPercent: 40,
      swapUsedCriticalPercent: 70,
      cpuLoadWarningPerCore: 2,
      cpuLoadCriticalPerCore: 4,
      overcommitWarningPercent: 80,
      overcommitCriticalPercent: 95,
    },
    reasons: [],
    agents: [],
    leakedSpecialists: [],
    topConsumers: [],
    smeeRelay: { configured: false, running: false, status: 'not_configured', message: 'not configured' },
  };
}
