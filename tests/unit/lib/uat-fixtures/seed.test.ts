/**
 * Tests for seedUatFixturesLocal (PAN-3362, WI-2).
 *
 * seedUatFixturesLocal touches stores that resolve OVERDECK_HOME two
 * different ways: each ~/.overdeck/agents/<id>/state.json (agent rows, plain fs) and
 * cache.db (CacheService — its db path is a top-level module constant
 * computed once at import time, plus the event-store singleton, also fixed
 * at import time). The only mechanism that reliably isolates the latter two
 * per test is vi.resetModules() + dynamic import of every path-sensitive
 * module AFTER the env vars for that test are stubbed — see
 * tests/dashboard/cache-service-init-home.test.ts for the established
 * per-test pattern this file follows.
 *
 * PAN-3917: review status is no longer a stored record (the review_status
 * table and its event-emit path are gone), so this file no longer asserts
 * anything about it.
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
  const { closeOverdeckDatabase } = await import('../../../../src/lib/overdeck/infra.js');
  closeOverdeckDatabase();
  vi.unstubAllEnvs();
  rmSync(tempHome, { recursive: true, force: true });
});

async function importSeedModules() {
  const seed = await import('../../../../src/lib/uat-fixtures/seed.js');
  const agentState = await import('../../../../src/lib/agents/agent-state.js');
  const cacheServiceModule = await import('../../../../src/dashboard/server/services/cache-service.js');
  return { seed, agentState, cacheServiceModule };
}

describe('seedUatFixturesLocal', () => {
  it('populates 5 agent rows and readable activity events (AC-1)', async () => {
    const { seed, agentState, cacheServiceModule } = await importSeedModules();

    const report = await seed.seedUatFixturesLocal({ detectContainer: () => true });
    expect(report.agentsWritten).toBe(5);
    expect(report.activityEntriesWritten).toBe(4);

    const agents = agentState.listAgentStatesSync().filter((a) => a.issueId === 'FIX-1');
    expect(agents).toHaveLength(5);

    const cache = new cacheServiceModule.CacheService();
    try {
      const cached = cache.get('github', 'issues');
      expect(cached).not.toBeNull();
      expect(cached?.data?.[0]?.identifier).toBe('FIX-1');
    } finally {
      cache.close();
    }
  });

  it('rejects without container env markers, even with real container-runtime evidence (AC-2)', async () => {
    vi.stubEnv('OVERDECK_DISABLE_DEACON', undefined as unknown as string);
    vi.stubEnv('CONTAINER_MODE', undefined as unknown as string);
    const { seed } = await importSeedModules();

    await expect(seed.seedUatFixturesLocal({ detectContainer: () => true })).rejects.toThrow(
      /refuses to seed outside a detected container runtime/,
    );
  });

  it('rejects with a container env marker set but no real container-runtime evidence, with no production override (AC-2, review finding UAT cycle 2)', async () => {
    // beforeEach already stubs OVERDECK_DISABLE_DEACON=1 — a caller-controlled
    // env var alone must not be enough to pass the guard.
    const { seed } = await importSeedModules();

    await expect(seed.seedUatFixturesLocal({ detectContainer: () => false })).rejects.toThrow(
      /refuses to seed outside a detected container runtime/,
    );
  });

  it('is idempotent: a second run leaves identical row counts in agents, the issue cache, and activity history (AC-3)', async () => {
    const { seed, agentState, cacheServiceModule } = await importSeedModules();

    await seed.seedUatFixturesLocal({ detectContainer: () => true });
    await seed.seedUatFixturesLocal({ detectContainer: () => true });

    const agents = agentState.listAgentStatesSync().filter((a) => a.issueId === 'FIX-1');
    expect(agents).toHaveLength(5);

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

    const report = await seed.seedUatFixturesLocal({ detectContainer: () => true });
    expect(report.planPath).toContain(join('uat-fixtures', 'repo', 'workspaces', 'feature-fix-1', '.overdeck'));
    expect(report.continuePath).toContain(join('uat-fixtures', 'repo', 'workspaces', 'feature-fix-1', '.overdeck'));

    const doc = readPlanSync(report.planPath);
    expect(doc.plan.items).toHaveLength(3);
  });

  it('uses Overdeck-owned workspace state as the validity marker without creating CLAUDE.md (AC-5)', async () => {
    const { seed } = await importSeedModules();
    const { fixtureWorkspacePath } = await import('../../../../src/lib/uat-fixtures/fixture-data.js');

    await seed.seedUatFixturesLocal({ detectContainer: () => true });

    expect(existsSync(join(fixtureWorkspacePath(), 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(fixtureWorkspacePath(), '.overdeck', 'spec.vbrief.json'))).toBe(true);
  });

  it('every agent row carries a branch (AC-6, review finding UAT cycle 2)', async () => {
    const { seed, agentState } = await importSeedModules();

    await seed.seedUatFixturesLocal({ detectContainer: () => true });

    // The work agent's seeded branch must survive the write door round-trip.
    const workAgent = agentState
      .listAgentStatesSync()
      .find((a) => a.issueId === 'FIX-1' && a.role === 'work');
    expect(workAgent?.branch).toBe('feature/fix-1');
  });
});
