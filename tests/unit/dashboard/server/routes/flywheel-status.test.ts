/**
 * PAN-4199 FR-4 — `GET /api/flywheel/status` derives from the server caches.
 *
 * The route injects `serverFlywheelStatusDeps()`, so the tracker rows come
 * from the shared `IssueDataService` cache and the derived states from the
 * server adapter in `services/derived-issue-state.ts`. This test runs that
 * real adapter: only the issue cache, the backend inventory, and the forge
 * listing are stubbed. Nothing here stubs `loadStates` — if the route stopped
 * injecting it, a closed issue would derive `working` again.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlywheelDerivedStatus } from '@overdeck/contracts';

import { getFlywheelStatusPayload, serverFlywheelStatusDeps } from '../../../../../src/dashboard/server/routes/flywheel.js';
import type { DeriveFlywheelStatusDeps } from '../../../../../src/lib/flywheel/derive-status.js';

const PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'flywheel-status-'));

const trackerCache: Record<string, { open: boolean; labels: readonly string[]; title?: string } | null> = {};

vi.mock('../../../../../src/dashboard/server/services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({ getTrackerIssue: (id: string) => trackerCache[id.toUpperCase()] ?? null }),
}));
vi.mock('../../../../../src/dashboard/server/services/backend-inventory.js', () => ({
  getBackendPanes: async () => [],
}));
vi.mock('../../../../../src/lib/overdeck/derived-issue-state.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../src/lib/overdeck/derived-issue-state.js')>()),
  listRepoPullRequestsStaleOk: async () => [],
}));

afterAll(() => rmSync(PROJECT_ROOT, { recursive: true, force: true }));

/** Everything the deriver reads apart from the two server-injected deps. */
function offlineDeps(issueIds: readonly string[]): DeriveFlywheelStatusDeps {
  return {
    ...serverFlywheelStatusDeps(),
    getConversation: () => null,
    sessionAlive: async () => false,
    readTranscript: async () => [],
    resolveProjectPath: () => PROJECT_ROOT,
    resolvePlanHome: () => PROJECT_ROOT,
    listWorkspaces: () => issueIds.map((issueId) => ({
      issueId,
      workspacePath: join(PROJECT_ROOT, 'workspaces', `feature-${issueId.toLowerCase()}`),
    })),
    lastJournal: () => null,
    policies: () => ({ auto_pickup_backlog: false, require_uat_before_merge: true, merge_train_enabled: false }),
    runningBook: () => null,
  };
}

async function statusFor(issueIds: readonly string[]): Promise<{ status: number; body: FlywheelDerivedStatus }> {
  const result = await getFlywheelStatusPayload(offlineDeps(issueIds));
  return { status: result.status, body: result.body as FlywheelDerivedStatus };
}

describe('GET /api/flywheel/status reads the server caches (PAN-4199 FR-4)', () => {
  beforeEach(() => {
    for (const key of Object.keys(trackerCache)) delete trackerCache[key];
  });

  it('drops an issue the cache reports closed and keeps the open one (ac1)', async () => {
    trackerCache['PAN-7'] = { open: false, labels: [] };
    trackerCache['PAN-8'] = { open: true, labels: [], title: 'Open thing' };
    const { status, body } = await statusFor(['PAN-7', 'PAN-8']);
    expect(status).toBe(200);
    expect(body.inFlight.map((row) => row.issueId)).toEqual(['PAN-8']);
  });

  it('carries the cached title onto the row (ac2)', async () => {
    trackerCache['PAN-7'] = { open: false, labels: [] };
    trackerCache['PAN-8'] = { open: true, labels: [], title: 'Open thing' };
    const { body } = await statusFor(['PAN-7', 'PAN-8']);
    expect(body.inFlight[0]?.title).toBe('Open thing');
    expect(body.inFlight[0]).not.toHaveProperty('trackerUnknown');
  });

  it('keeps the deriver free of any dashboard/server import (ac3)', () => {
    const deriver = readFileSync(join(__dirname, '../../../../../src/lib/flywheel/derive-status.ts'), 'utf-8');
    expect(deriver).not.toContain('dashboard/server');
  });

  it('reports an issue no tracker has as unknown rather than open', async () => {
    const { body } = await statusFor(['PAN-9']);
    expect(body.inFlight).toEqual([
      expect.objectContaining({ issueId: 'PAN-9', title: null, trackerUnknown: true }),
    ]);
  });
});
