/**
 * Tests for seedUatFixturesLocal (PAN-3362, WI-2).
 *
 * seedUatFixturesLocal touches stores that resolve OVERDECK_HOME two
 * different ways: overdeck.db (agents/events/review_status, all via
 * getOverdeckDatabaseSync() — a path-keyed cache that self-heals when the
 * path changes) and cache.db (CacheService — its db path is a top-level
 * module constant computed once at import time, plus the event-store
 * singleton, also fixed at import time). The only mechanism that reliably
 * isolates the latter two per test is vi.resetModules() + dynamic import of
 * every path-sensitive module AFTER the env vars for that test are stubbed
 * — see tests/dashboard/cache-service-init-home.test.ts for the established
 * per-test pattern this file follows.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'uat-fixtures-seed-test-'));
  vi.resetModules();
  vi.stubEnv('OVERDECK_HOME', tempHome);
  vi.stubEnv('OVERDECK_DISABLE_DEACON', '1');
  vi.stubEnv('CONTAINER_MODE', undefined as unknown as string);
});

afterEach(async () => {
  const { closeOverdeckDatabaseSync } = await import('../../../../src/lib/overdeck/infra.js');
  closeOverdeckDatabaseSync();
  vi.unstubAllEnvs();
  rmSync(tempHome, { recursive: true, force: true });
});

async function importSeedModules() {
  const seed = await import('../../../../src/lib/uat-fixtures/seed.js');
  const agentStateSync = await import('../../../../src/lib/overdeck/agent-state-sync.js');
  const reviewStatusSync = await import('../../../../src/lib/overdeck/review-status-sync.js');
  const cacheServiceModule = await import('../../../../src/dashboard/server/services/cache-service.js');
  return { seed, agentStateSync, reviewStatusSync, cacheServiceModule };
}

describe('seedUatFixturesLocal', () => {
  it('populates 5 agent rows, 1 review_status row with PR fields, and readable activity events (AC-1)', async () => {
    const { seed, agentStateSync, reviewStatusSync, cacheServiceModule } = await importSeedModules();

    const report = await seed.seedUatFixturesLocal();
    expect(report.agentsWritten).toBe(5);
    expect(report.activityEntriesWritten).toBe(4);

    const agents = agentStateSync.listOverdeckAgentStatesSync().filter((a) => a.issueId === 'FIX-1');
    expect(agents).toHaveLength(5);

    const status = reviewStatusSync.getReviewStatusFromDbSync('FIX-1');
    expect(status).not.toBeNull();
    expect(status?.prUrl).toBeTruthy();
    expect(status?.prNumber).toBeTruthy();
    expect(status?.prHeadSha).toBeTruthy();

    const cache = new cacheServiceModule.CacheService();
    try {
      const cached = cache.get('github', 'issues');
      expect(cached).not.toBeNull();
      expect(cached?.data?.[0]?.identifier).toBe('FIX-1');
    } finally {
      cache.close();
    }
  });

  it('rejects without container env markers, with no override (AC-2)', async () => {
    vi.stubEnv('OVERDECK_DISABLE_DEACON', undefined as unknown as string);
    vi.stubEnv('CONTAINER_MODE', undefined as unknown as string);
    const { seed } = await importSeedModules();

    await expect(seed.seedUatFixturesLocal()).rejects.toThrow(/refuses to seed a non-container OVERDECK_HOME/);
  });

  it('is idempotent: a second run leaves identical row counts in agents, review_status, the issue cache, and activity history (AC-3)', async () => {
    const { seed, agentStateSync, reviewStatusSync, cacheServiceModule } = await importSeedModules();

    await seed.seedUatFixturesLocal();
    await seed.seedUatFixturesLocal();

    const agents = agentStateSync.listOverdeckAgentStatesSync().filter((a) => a.issueId === 'FIX-1');
    expect(agents).toHaveLength(5);

    const statuses = Object.keys(reviewStatusSync.getAllReviewStatusesFromDb());
    expect(statuses.filter((id) => id === 'FIX-1')).toHaveLength(1);

    const cache = new cacheServiceModule.CacheService();
    try {
      const cached = cache.get('github', 'issues');
      expect(cached?.data).toHaveLength(1);
    } finally {
      cache.close();
    }

    const { getEventStore } = await import('../../../../src/dashboard/server/event-store.js');
    const fixtureActivityEntries = getEventStore()
      .queryByType('activity.entry', 1000)
      .filter((event) => (event.payload as { issueId?: string }).issueId === 'FIX-1');
    expect(fixtureActivityEntries).toHaveLength(4);
  });

  it('persists spec.vbrief.json and continue.json under the fixture workspace and the spec passes the plan reader (AC-4)', async () => {
    const { seed } = await importSeedModules();
    const { readPlanSync } = await import('../../../../src/lib/xbrief/io.js');

    const report = await seed.seedUatFixturesLocal();
    expect(report.planPath).toContain(join('uat-fixtures', 'repo', 'workspaces', 'feature-fix-1', '.overdeck'));
    expect(report.continuePath).toContain(join('uat-fixtures', 'repo', 'workspaces', 'feature-fix-1', '.overdeck'));

    const doc = readPlanSync(report.planPath);
    expect(doc.plan.items).toHaveLength(3);
  });

  it('writes a CLAUDE.md marker at the workspace root so GET /api/workspaces/FIX-1 does not report corrupted (AC-5)', async () => {
    const { seed } = await importSeedModules();
    const { fixtureWorkspacePath } = await import('../../../../src/lib/uat-fixtures/fixture-data.js');

    await seed.seedUatFixturesLocal();

    const claudeMdPath = join(fixtureWorkspacePath(), 'CLAUDE.md');
    expect(existsSync(claudeMdPath)).toBe(true);
    expect(readFileSync(claudeMdPath, 'utf-8').length).toBeGreaterThan(0);
  });
});
