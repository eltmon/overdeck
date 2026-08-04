import { getOverdeckDatabaseSync } from './infra.js';

/** Lightweight agents read-door projection used by hot review-status reads. */
export interface ReviewArtifactProvenance {
  workspace: string;
  reviewRunId: string;
}

export function getReviewArtifactProvenanceSync(
  reviewAgentId: string,
): ReviewArtifactProvenance | null {
  const row = getOverdeckDatabaseSync()
    .prepare('SELECT workspace, review_run_id FROM agents WHERE id = ?')
    .get(reviewAgentId) as { workspace: string; review_run_id: string | null } | undefined;

  if (!row?.review_run_id) return null;
  return { workspace: row.workspace, reviewRunId: row.review_run_id };
}
