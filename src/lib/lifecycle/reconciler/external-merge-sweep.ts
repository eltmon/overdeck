/**
 * Reconciler external-merge sweep (PAN-805).
 *
 * Tick step 3: detect issues that were merged via the GitHub web UI (closed on
 * GitHub but missing the 'merged' label) and enqueue the label write.
 */

import { getDatabase } from '../../database/index.js';
import { parseGitHubRepos } from '../../tracker-utils.js';
import { setCanonicalState } from './index.js';
import type { GitHubClient } from './github-client.js';
import type { ReconcilerConfig } from './types.js';

function resolvePrefix(config: ReconcilerConfig): string | null {
  const repos = parseGitHubRepos();
  const [owner, repo] = config.repo.split('/');
  const match = repos.find((r) => r.owner === owner && r.repo === repo);
  return match ? match.prefix : null;
}

export async function runExternalMergeSweep(
  config: ReconcilerConfig,
  gh: GitHubClient,
  cachedPrefix?: string | null,
): Promise<void> {
  const db = getDatabase();
  const prefix = cachedPrefix ?? resolvePrefix(config);
  if (!prefix) {
    console.warn(
      `[reconciler:external-merge-sweep] Could not resolve prefix for repo ${config.repo}`
    );
    return;
  }

  // Fetch closed issues (page 1 is sufficient for the sweep; external merges are rare)
  let fetched: Array<{ number: number; state: string; labels: Array<{ name: string }> }>;
  try {
    fetched = await gh.listIssues({ state: 'closed', perPage: 100, page: 1 });
  } catch (err) {
    console.warn('[reconciler:external-merge-sweep] listIssues failed:', err);
    return;
  }

  if (fetched.length === 0) return;

  for (const issue of fetched) {
    const labelNames = issue.labels.map((l) => l.name.toLowerCase());

    // Already labeled as merged or wontfix — nothing to do
    if (labelNames.includes('merged') || labelNames.includes('wontfix')) {
      continue;
    }

    const issueId = `${prefix}-${issue.number}`;

    const localRow = db
      .prepare(
        `SELECT canonical_state FROM issue_state WHERE issue_id = ?`
      )
      .get(issueId) as { canonical_state: string } | undefined;

    if (!localRow) {
      // Not tracked by Panopticon
      continue;
    }

    // If already marked closed_wontfix locally, respect that
    if (localRow.canonical_state === 'closed_wontfix') {
      continue;
    }

    // If already marked merged locally, the push step should have applied the label.
    // If it hasn't, something went wrong — we'll still enqueue to retry.
    if (localRow.canonical_state === 'merged') {
      // Re-enqueue the merged label via setCanonicalState (updates updated_at)
      setCanonicalState(issueId, 'merged', 'external_merge_detected');
      console.log(
        `[reconciler:external-merge-sweep] Re-enqueued merged label for ${issueId}`
      );
      continue;
    }

    // Issue is closed on GitHub without merged/wontfix labels, and local state
    // doesn't reflect closure. Assume external merge and update canonical state.
    setCanonicalState(issueId, 'merged', 'external_merge_detected');
    console.log(
      `[reconciler:external-merge-sweep] Detected external merge for ${issueId}, enqueued merged label`
    );
  }
}
