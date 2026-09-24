/**
 * Merged-issue Docker reconciliation (PAN-3917 FR-11).
 *
 * A merged issue's `_devnet` bridge network outlives its agents, its workspace
 * and its agent dirs, and Docker's default address pools hold only ~31 of them.
 * Reclaiming one is host hygiene on a Docker resource — it is not triggered by
 * the tracker, so it does not belong in the closed-issue reaper (whose trigger
 * IS the tracker). It runs on its own interval in `hygiene-scheduler.ts`.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { getPrFacts } from './pr-facts.js';
import { reconcileMergedDockerCleanupQueue } from './merged-docker-cleanup-worker.js';

const execAsync = promisify(exec);

/**
 * Issue ids with a leftover `*-feature-<issue>_devnet` bridge network, or
 * `null` when Docker could not be read at all.
 */
export async function listFeatureDevnetIssueIds(): Promise<string[] | null> {
  try {
    const { stdout } = await execAsync(`docker network ls --format '{{.Name}}'`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
    const issueIds = new Set<string>();
    for (const name of stdout.trim().split('\n')) {
      const match = name.match(/-feature-([a-z]+-\d+)_devnet$/i);
      if (match) issueIds.add(match[1].toUpperCase());
    }
    return [...issueIds];
  } catch {
    return null;
  }
}

/** Queue Docker cleanup for every devnet network whose issue's PR has merged. */
export async function reconcileMergedIssueDocker(): Promise<string[]> {
  const devnetIssueIds = await listFeatureDevnetIssueIds();
  if (!devnetIssueIds) return [];

  let mergedIssueIds: string[];
  try {
    const merged = await Promise.all(devnetIssueIds.map(async (issueId) => ({
      issueId,
      merged: (await getPrFacts(issueId)).merged,
    })));
    mergedIssueIds = merged.filter((entry) => entry.merged).map((entry) => entry.issueId);
  } catch (error) {
    // An unreadable forge is not evidence that nothing merged: leave the queue
    // exactly as it is rather than pruning live entries out of it.
    return [`Failed to resolve merged-issue Docker cleanup status: ${error}`];
  }

  try {
    return reconcileMergedDockerCleanupQueue(mergedIssueIds);
  } catch (error) {
    return [`Failed to reconcile merged-issue Docker cleanup queue: ${error}`];
  }
}
