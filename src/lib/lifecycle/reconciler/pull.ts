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
 */
function remoteToCanonical(
  state: string,
  labels: string[],
): CanonicalState {
  const stateLower = state.toLowerCase();
  const labelNames = labels.map((l) => l.toLowerCase());

  if (stateLower === 'closed') {
    if (labelNames.some((l) => l === 'wontfix' || l === "won't do" || l === 'duplicate')) {
      return 'closed_wontfix';
    }
    // Closed without cancel label → treat as merged (post-merge closure)
    return 'merged';
  }

  if (labelNames.some((l) => l === 'merged' || l === 'needs-close-out')) {
    return 'merged';
  }
  if (labelNames.some((l) => l.includes('in review') || l.includes('in-review') || l.includes('review'))) {
    return 'in_review';
  }
  if (labelNames.some((l) => l.includes('in progress') || l.includes('in-progress') || l.includes('wip'))) {
    return 'in_progress';
  }

  return 'todo';
}

/**
 * Resolve the issue prefix for the configured repo.
 */
function resolvePrefix(config: ReconcilerConfig): string | null {
  const repos = parseGitHubRepos();
  const [owner, repo] = config.repo.split('/');
  const match = repos.find((r) => r.owner === owner && r.repo === repo);
  return match ? match.prefix : null;
}

export async function runPullStep(
  config: ReconcilerConfig,
  gh: GitHubClient,
): Promise<void> {
  const db = getDatabase();
  const prefix = resolvePrefix(config);
  if (!prefix) {
    console.warn(`[reconciler:pull] Could not resolve prefix for repo ${config.repo}`);
    return;
  }

  // Fetch open issues only (terminal states don't change on remote without local intent)
  let page = 1;
  const perPage = 100;
  let fetched: Array<{ number: number; state: string; labels: Array<{ name: string }> }>;

  try {
    fetched = await gh.listIssues({ state: 'open', perPage, page });
  } catch (err) {
    console.warn('[reconciler:pull] listIssues failed:', err);
    return;
  }

  if (fetched.length === 0) return;

  const now = new Date().toISOString();

  for (const issue of fetched) {
    const issueId = `${prefix}-${issue.number}`;
    const remoteCanonical = remoteToCanonical(
      issue.state,
      issue.labels.map((l) => l.name),
    );

    const localRow = db
      .prepare(
        `SELECT canonical_state, pending_mutation FROM issue_state WHERE issue_id = ?`
      )
      .get(issueId) as
      | { canonical_state: CanonicalState; pending_mutation: string | null }
      | undefined;

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

    // Remote wins — update local canonical_state
    db.prepare(
      `UPDATE issue_state SET canonical_state = ?, updated_at = ? WHERE issue_id = ?`
    ).run(remoteCanonical, now, issueId);

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
