/**
 * UAT fixture seed writer (PAN-3362, WI-2).
 *
 * Writes the FIX-1 fixture set (built by fixture-data.ts) into the
 * container-local OVERDECK_HOME through the canonical write doors — no raw
 * SQL. Refuses to run outside a workspace container unless explicitly
 * forced, so polluting a host OVERDECK_HOME is a deliberate act.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getOverdeckHome } from '../paths.js';
import { registerProjectSync } from '../projects.js';
import { saveOverdeckAgentStateSync } from '../overdeck/agent-state-sync.js';
import { upsertReviewStatusSync } from '../overdeck/review-status-sync.js';
import { emitActivityEntryDurable } from '../activity-logger.js';
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

export interface SeedUatFixturesOptions {
  /** Bypass the container-env guard. Also polluting a non-container OVERDECK_HOME is deliberate. */
  force?: boolean;
}

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
 * on server) — see docs/WORKSPACE-CONTAINERS.md.
 */
function assertContainerEnvUnlessForced(force: boolean | undefined): void {
  if (force) return;
  if (process.env.OVERDECK_DISABLE_DEACON === '1' || process.env.CONTAINER_MODE === '1') return;
  throw new Error(
    'seedUatFixturesLocal refuses to seed a non-container OVERDECK_HOME (neither ' +
    'OVERDECK_DISABLE_DEACON=1 nor CONTAINER_MODE=1 is set in the environment). ' +
    'Pass { force: true } (CLI: --force) to seed anyway.',
  );
}

/**
 * Seeds the FIX-1 fixture set into the current OVERDECK_HOME through the
 * canonical write doors. Idempotent: every write is an upsert, so re-running
 * leaves identical row counts in agents, review_status, and the issue cache.
 */
export async function seedUatFixturesLocal(opts: SeedUatFixturesOptions = {}): Promise<SeedReport> {
  assertContainerEnvUnlessForced(opts.force);

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
    await emitActivityEntryDurable(entry);
  }

  const workspaceOverdeckDir = join(
    home, FIXTURE_PROJECT_KEY, 'repo', 'workspaces', 'feature-fix-1', '.overdeck',
  );
  await mkdir(workspaceOverdeckDir, { recursive: true });
  const planPath = join(workspaceOverdeckDir, 'spec.vbrief.json');
  const continuePath = join(workspaceOverdeckDir, 'continue.json');
  await writeFile(planPath, serializeXBriefDocument(fixtureXBriefDoc()));
  await writeFile(continuePath, JSON.stringify(fixtureContinueJson(), null, 2));

  return {
    issueId: FIXTURE_ISSUE_ID,
    projectKey: FIXTURE_PROJECT_KEY,
    agentsWritten: agents.length,
    activityEntriesWritten: activityEntries.length,
    planPath,
    continuePath,
  };
}
