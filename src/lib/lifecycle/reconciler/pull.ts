/**
 * Reconciler pull step (PAN-805).
 *
 * Tick step 2: list open issues from GitHub, detect remote-ahead state,
 * update local canonical_state when remote differs and no pending mutation.
 */

import { getDatabase } from '../../database/index.js';
import { parseGitHubRepos } from '../../tracker-utils.js';
import { recordAudit } from './audit.js';
import type { GitHubClient } from './github-client.js';
import type { CanonicalState, ReconcilerConfig } from './types.js';

/**
 * Map GitHub labels + state to reconciler canonical_state.
 * Uses Set-based lookups for O(1) matching instead of repeated .some() scans.
 */
function remoteToCanonical(
  state: string,
  labels: string[],
): CanonicalState {
  const stateLower = state.toLowerCase();
  const labelSet = new Set(labels.map((l) => l.toLowerCase()));

  if (stateLower === 'closed') {
    if (labelSet.has('wontfix') || labelSet.has("won't do") || labelSet.has('duplicate')) {
      return 'closed_wontfix';
    }
    // Closed without cancel label → treat as merged (post-merge closure)
    return 'merged';
  }

  if (labelSet.has('merged') || labelSet.has('needs-close-out')) {
    return 'merged';
  }
  if (labelSet.has('in-review')) {
    return 'in_review';
  }
  if (labelSet.has('in-progress')) {
    return 'in_progress';
  }

  return 'todo';
}

/**
 * Resolve the issue prefix for the configured repo.
 */
export function resolvePrefix(config: ReconcilerConfig): string | null {
  const repos = parseGitHubRepos();
  const [owner, repo] = config.repo.split('/');
  const match = repos.find((r) => r.owner === owner && r.repo === repo);
  return match ? match.prefix : null;
}

export async function runPullStep(
  config: ReconcilerConfig,
  gh: GitHubClient,
  cachedPrefix?: string | null,
): Promise<void> {
  const db = getDatabase();
  const prefix = cachedPrefix ?? resolvePrefix(config);
  if (!prefix) {
    console.warn(`[reconciler:pull] Could not resolve prefix for repo ${config.repo}`);
    return;
  }

  // Fetch open issues with pagination (terminal states don't change on remote without local intent)
  const perPage = 100;
  const now = new Date().toISOString();

  for (let page = 1; ; page++) {
    let fetched: Array<{ number: number; state: string; labels: Array<{ name: string }> }>;
    try {
      fetched = await gh.listIssues({ state: 'open', perPage, page });
    } catch (err) {
      console.warn('[reconciler:pull] listIssues failed:', err);
      return;
    }

    if (fetched.length === 0) break;

    // Batch-query local state for all issues on this page to avoid N+1 queries
    const issueIds = fetched.map((issue) => `${prefix}-${issue.number}`);
    const placeholders = issueIds.map(() => '?').join(',');
    const localRows = db
      .prepare(
        `SELECT issue_id, canonical_state, pending_mutation FROM issue_state WHERE issue_id IN (${placeholders})`
      )
      .all(...issueIds) as Array<{
        issue_id: string;
        canonical_state: CanonicalState;
        pending_mutation: string | null;
      }>;
    const localMap = new Map(localRows.map((r) => [r.issue_id, r]));

    for (const issue of fetched) {
      const issueId = `${prefix}-${issue.number}`;
      const remoteCanonical = remoteToCanonical(
        issue.state,
        issue.labels.map((l) => l.name),
      );

      const localRow = localMap.get(issueId);
      if (!localRow) {
        // Issue not tracked locally — skip (backfill handles cold-start seeding)
        continue;
      }

      if (localRow.canonical_state === remoteCanonical) {
        continue;
      }

      if (localRow.pending_mutation) {
        console.warn(
          `[reconciler:pull] Remote ahead for ${issueId} (remote=${remoteCanonical}, local=${localRow.canonical_state}), but pending_mutation=${localRow.pending_mutation}. Local intent wins.`
        );
        continue;
      }

      // Remote wins — update local canonical_state and advance sync timestamp
      db.prepare(
        `UPDATE issue_state SET canonical_state = ?, updated_at = ?, last_synced_at = ? WHERE issue_id = ?`
      ).run(remoteCanonical, now, now, issueId);

      recordAudit({
        issueId,
        targetLabel: '',
        action: 'add',
        outcome: 'skipped',
        reason: 'remote_ahead_pulled',
        retryCount: 0,
      });

      console.log(
        `[reconciler:pull] Updated ${issueId} canonical_state ${localRow.canonical_state} → ${remoteCanonical} (remote ahead)`
      );
    }
  }
}
