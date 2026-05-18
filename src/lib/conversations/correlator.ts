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
  actualCost: number | null;
  costEventCount: number;
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
        const existing = map.get(path);
        map.set(path, {
          panopticonManaged: true,
          panIssueId: row.issue_id,
          panAgentId: row.name,
          actualCost: existing?.actualCost ?? null,
          costEventCount: existing?.costEventCount ?? 0,
        });
      }
    }
  }

  const pathsBySessionId = new Map<string, string[]>();
  for (const path of jsonlPaths) {
    const sessionId = path.split('/').pop()?.replace(/\.jsonl$/, '');
    if (!sessionId) continue;
    const paths = pathsBySessionId.get(sessionId) ?? [];
    paths.push(path);
    pathsBySessionId.set(sessionId, paths);
  }

  const sessionIds = [...pathsBySessionId.keys()];
  for (let i = 0; i < sessionIds.length; i += 500) {
    const chunk = sessionIds.slice(i, i + 500);
    const placeholders = chunk.map(() => '?').join(',');
    const costRows = db
      .prepare(
        `SELECT session_id, MIN(issue_id) AS issue_id, MIN(agent_id) AS agent_id,
                SUM(cost) AS actual_cost, COUNT(*) AS event_count
         FROM cost_events
         WHERE session_id IN (${placeholders})
         GROUP BY session_id`,
      )
      .all(...chunk) as Array<{
      session_id: string;
      issue_id: string | null;
      agent_id: string | null;
      actual_cost: number;
      event_count: number;
    }>;

    for (const row of costRows) {
      const paths = pathsBySessionId.get(row.session_id) ?? [];
      for (const path of paths) {
        const existing = map.get(path);
        map.set(path, {
          panopticonManaged: true,
          panIssueId: existing?.panIssueId ?? row.issue_id,
          panAgentId: existing?.panAgentId ?? row.agent_id,
          actualCost: row.actual_cost,
          costEventCount: row.event_count,
        });
      }
    }
  }

  return map;
}
