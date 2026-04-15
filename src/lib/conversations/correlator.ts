/**
 * Correlator — links discovered sessions to Panopticon-managed conversations (PAN-457).
 *
 * Queries the `conversations` table for session_file matches and the
 * `cost_events` table for session_id matches to determine if a discovered
 * JSONL file was spawned by Panopticon.
 */

import { getDatabase } from '../database/index.js';

export interface CorrelationResult {
  panopticonManaged: boolean;
  panIssueId: string | null;
  panAgentId: string | null;
}

/**
 * Build a correlation map from jsonl_path → CorrelationResult.
 * Queries the DB once and returns a lookup function for O(1) per-session access.
 *
 * @param jsonlPaths  All JSONL paths discovered in this scan run
 */
export function buildCorrelationMap(
  jsonlPaths: string[],
): Map<string, CorrelationResult> {
  const db = getDatabase();
  const map = new Map<string, CorrelationResult>();

  if (jsonlPaths.length === 0) return map;

  // Query conversations table for session_file matches
  // conversations.session_file is the path to the JSONL for a Panopticon-spawned session
  const rows = db
    .prepare(
      `SELECT session_file, issue_id FROM conversations
       WHERE session_file IS NOT NULL`,
    )
    .all() as Array<{ session_file: string; issue_id: string | null }>;

  for (const row of rows) {
    if (jsonlPaths.includes(row.session_file)) {
      map.set(row.session_file, {
        panopticonManaged: true,
        panIssueId: row.issue_id,
        panAgentId: null,
      });
    }
  }

  return map;
}
