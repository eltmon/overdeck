/**
 * Correlator — links discovered sessions to Panopticon-managed conversations (PAN-457).
 *
 * Queries the `conversations` table for session_file matches and the
 * `cost_events` table for session_id matches to determine if a discovered
 * JSONL file was spawned by Panopticon.
 */

import { getDatabase } from '../database/index.js';
import { sessionFilePath } from '../paths.js';

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

  const pathSet = new Set(jsonlPaths);
  const rows = db
    .prepare(
      `SELECT name, cwd, session_file, claude_session_id, issue_id FROM conversations
       WHERE session_file IS NOT NULL OR claude_session_id IS NOT NULL`,
    )
    .all() as Array<{
    name: string;
    cwd: string;
    session_file: string | null;
    claude_session_id: string | null;
    issue_id: string | null;
  }>;

  for (const row of rows) {
    const candidatePaths = new Set<string>();
    if (row.session_file) candidatePaths.add(row.session_file);
    if (row.claude_session_id) candidatePaths.add(sessionFilePath(row.cwd, row.claude_session_id));

    for (const path of candidatePaths) {
      if (pathSet.has(path)) {
        map.set(path, {
          panopticonManaged: true,
          panIssueId: row.issue_id,
          panAgentId: row.name,
        });
      }
    }
  }

  return map;
}
