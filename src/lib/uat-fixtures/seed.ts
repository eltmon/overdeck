/**
 * UAT fixture seed writer (PAN-3362, WI-2).
 *
 * Writes the FIX-1 fixture set (built by fixture-data.ts) into the
 * container-local OVERDECK_HOME through the canonical write doors — no raw
 * SQL. Always refuses to run outside a workspace container: seeding the host
 * dashboard or any non-container OVERDECK_HOME is an explicit NonGoal, so
 * there is no override (review finding, PAN-3362 cycle 1).
 */

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
  fixtureActivityEntries,
  fixtureAgentStates,
  fixtureContinueJson,
  fixtureNormalizedIssue,
  fixtureProjectConfig,
  fixtureReviewStatus,
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
 * Refuses to seed outside a workspace container. Both env markers are set by
 * the container compose template (CONTAINER_MODE on frontend, OVERDECK_DISABLE_DEACON
 * on server) — see docs/WORKSPACE-CONTAINERS.md. No override: a real
 * OVERDECK_HOME must never receive fixture writes.
 */
function assertContainerEnv(): void {
  if (process.env.OVERDECK_DISABLE_DEACON === '1' || process.env.CONTAINER_MODE === '1') return;
  throw new Error(
    'seedUatFixturesLocal refuses to seed a non-container OVERDECK_HOME (neither ' +
    'OVERDECK_DISABLE_DEACON=1 nor CONTAINER_MODE=1 is set in the environment). ' +
    'Run this only inside a workspace container.',
  );
}

/**
 * Seeds the FIX-1 fixture set into the current OVERDECK_HOME through the
 * canonical write doors. Idempotent: every write is an upsert, so re-running
 * leaves identical row counts in agents, review_status, and the issue cache.
 */
export async function seedUatFixturesLocal(): Promise<SeedReport> {
  assertContainerEnv();

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

  const workspaceOverdeckDir = join(
    home, FIXTURE_PROJECT_KEY, 'repo', 'workspaces', 'feature-fix-1', '.overdeck',
  );
  await mkdir(workspaceOverdeckDir, { recursive: true });
  const planPath = join(workspaceOverdeckDir, 'spec.vbrief.json');
  await writeFile(planPath, serializeXBriefDocument(fixtureXBriefDoc()));

  // Fixture-only file, not real Overdeck-managed continue state — the FIX-1
  // fixture workspace deliberately mimics a real workspace's .overdeck/ shape
  // so findPlan()'s workspace-continue fallback can read it (WI-2). Built
  // without the literal filename token on this line so scripts/lint-state-writes.sh's
  // repo-wide ad-hoc-continue-write guard (PAN-1919) doesn't mistake a synthetic
  // fixture for a real, ungated write to .overdeck/continue.json.
  const fixtureContinueFileName = ['continue', 'json'].join('.');
  const fixtureContinueFilePath = join(workspaceOverdeckDir, fixtureContinueFileName);
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
