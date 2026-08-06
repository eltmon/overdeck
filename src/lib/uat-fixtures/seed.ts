/**
 * UAT fixture seed writer (PAN-3362, WI-2).
 *
 * Writes the FIX-1 fixture set (built by fixture-data.ts) into the
 * container-local OVERDECK_HOME through the canonical write doors — no raw
 * SQL. Always refuses to run outside a real container runtime: seeding the
 * host dashboard or any non-container OVERDECK_HOME is an explicit NonGoal,
 * so there is no production override (review findings, PAN-3362 cycle 1 and
 * UAT cycle 2) — the container check itself is injectable only for tests.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getOverdeckHome } from '../paths.js';
import { registerProjectSync } from '../projects.js';
import { saveOverdeckAgentStateSync } from '../overdeck/agent-state-sync.js';
import { upsertReviewStatusSync } from '../overdeck/review-status-sync.js';
import { emitActivityEntryOnce } from '../activity-logger.js';
import { serializeXBriefDocument } from '../xbrief/io.js';
import {
  FIXTURE_ISSUE_ID,
  FIXTURE_PROJECT_KEY,
  FIXTURE_WORKSPACE_CLAUDE_MD,
  fixtureActivityEntries,
  fixtureAgentStates,
  fixtureContinueJson,
  fixtureNormalizedIssue,
  fixtureProjectConfig,
  fixtureReviewStatus,
  fixtureWorkspacePath,
  fixtureXBriefDoc,
} from './fixture-data.js';

export interface SeedReport {
  issueId: string;
  projectKey: string;
  agentsWritten: number;
  activityEntriesWritten: number;
  planPath: string;
  continuePath: string;
}

/**
 * True only when the process is actually running inside a container
 * runtime — the same real signal `shouldRefuseHostDashboardPort()` in
 * src/dashboard/server/identity.ts:86-89 uses, rather than an
 * environment variable a host process could set by hand.
 */
export function isRunningInContainer(): boolean {
  return existsSync('/.dockerenv') || existsSync('/run/.containerenv');
}

/**
 * Refuses to seed outside a real container runtime. OVERDECK_DISABLE_DEACON
 * and CONTAINER_MODE are ordinary caller-controlled environment variables —
 * proof of intent, not proof of isolation — so a host process that merely
 * sets one of them by hand must still be rejected. Both markers remain a
 * required defense-in-depth check alongside the real container-runtime
 * check: the container compose template always sets one of them (see
 * docs/WORKSPACE-CONTAINERS.md), so a genuine container satisfies both.
 * No override in production: a real host OVERDECK_HOME must never receive
 * fixture writes (review finding, PAN-3362 UAT cycle 2).
 */
function assertContainerEnv(detectContainer: () => boolean = isRunningInContainer): void {
  const hasContainerEnvMarker =
    process.env.OVERDECK_DISABLE_DEACON === '1' || process.env.CONTAINER_MODE === '1';
  if (hasContainerEnvMarker && detectContainer()) return;
  throw new Error(
    'seedUatFixturesLocal refuses to seed outside a detected container runtime ' +
    '(requires both a container env marker — OVERDECK_DISABLE_DEACON=1 or ' +
    'CONTAINER_MODE=1 — and real container-runtime evidence — /.dockerenv or ' +
    '/run/.containerenv). Run this only inside a workspace container.',
  );
}

export interface SeedUatFixturesOptions {
  /**
   * Injectable override for the real container-runtime check, so tests can
   * simulate running inside a container without a real /.dockerenv file.
   * Production callers (the CLI) never pass this — defaults to the real
   * isRunningInContainer() detection.
   */
  detectContainer?: () => boolean;
}

/**
 * Seeds the FIX-1 fixture set into the current OVERDECK_HOME through the
 * canonical write doors. Idempotent: every write is an upsert, so re-running
 * leaves identical row counts in agents, review_status, and the issue cache.
 */
export async function seedUatFixturesLocal(options: SeedUatFixturesOptions = {}): Promise<SeedReport> {
  assertContainerEnv(options.detectContainer);

  const home = getOverdeckHome();
  await mkdir(home, { recursive: true });

  registerProjectSync(FIXTURE_PROJECT_KEY, fixtureProjectConfig());

  const { CacheService } = await import('../../dashboard/server/services/cache-service.js');
  const cache = new CacheService();
  try {
    cache.set('github', 'issues', [fixtureNormalizedIssue()], { ttlSeconds: 86_400 });
  } finally {
    cache.close();
  }

  const agents = fixtureAgentStates();
  for (const agent of agents) {
    saveOverdeckAgentStateSync(agent);
  }

  upsertReviewStatusSync(fixtureReviewStatus());

  const { initEventStore } = await import('../../dashboard/server/event-store.js');
  await initEventStore();
  const activityEntries = fixtureActivityEntries();
  for (const entry of activityEntries) {
    // At-most-once by stable id: a re-seed must not append duplicate visible
    // lifecycle events (review finding, PAN-3362 cycle 1). Only 'appended' and
    // 'duplicate' are durable outcomes — 'failed'/'unconfirmed' must not be
    // reported as a successful write (review finding, PAN-3362 cycle 2).
    const outcome = await emitActivityEntryOnce(entry);
    if (outcome !== 'appended' && outcome !== 'duplicate') {
      throw new Error(`Failed to persist fixture activity entry ${entry.id}: emitActivityEntryOnce returned '${outcome}'`);
    }
  }

  // fixtureWorkspacePath() re-derives from the current OVERDECK_HOME rather
  // than a hardcoded literal, so this always agrees with both the path
  // registerProjectSync() just wrote via fixtureProjectConfig() (review
  // finding, PAN-3362 cycle 3) and the path GET /api/workspaces/FIX-1
  // independently derives from the registered project (review finding,
  // PAN-3362 UAT cycle 1).
  const workspaceRoot = fixtureWorkspacePath();

  // Marker file so the workspace-structure check in getWorkspaceRoute
  // (src/dashboard/server/routes/workspaces/workspace-data.ts) does not
  // report the seeded directory as corrupted — see FIXTURE_WORKSPACE_CLAUDE_MD.
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, 'CLAUDE.md'), FIXTURE_WORKSPACE_CLAUDE_MD);

  const workspaceOverdeckDir = join(workspaceRoot, '.overdeck');
  await mkdir(workspaceOverdeckDir, { recursive: true });
  const planPath = join(workspaceOverdeckDir, 'spec.vbrief.json');
  await writeFile(planPath, serializeXBriefDocument(fixtureXBriefDoc()));

  // Fixture-only file, not real Overdeck-managed continue state — the FIX-1
  // fixture workspace deliberately mimics a real workspace's .overdeck/ shape
  // so findPlan()'s workspace-continue fallback can read it (WI-2). This
  // exact write is a declared, narrow exception in scripts/lint-state-writes.sh's
  // CONTINUE_FIXTURE_EXCEPTIONS (PAN-1919 ad-hoc-continue-write guard), not an
  // evasion of it — the guard still fails any other new continue.json write.
  const fixtureContinueFilePath = join(workspaceOverdeckDir, 'continue.json');
  const fixtureContinueBody = JSON.stringify(fixtureContinueJson(), null, 2);
  await writeFile(fixtureContinueFilePath, fixtureContinueBody);

  return {
    issueId: FIXTURE_ISSUE_ID,
    projectKey: FIXTURE_PROJECT_KEY,
    agentsWritten: agents.length,
    activityEntriesWritten: activityEntries.length,
    planPath,
    continuePath: fixtureContinueFilePath,
  };
}
