/**
 * Correlator — links discovered sessions to Overdeck-managed conversations (PAN-457).
 *
 * Queries the `conversations` table for session_file matches and the
 * `cost_events` table for session_id matches to determine if a discovered
 * JSONL file was spawned by Overdeck.
 */

import { Effect } from 'effect';
import { getOverdeckDatabaseSync } from '../overdeck/infra.js';
import { sessionFilePath } from '../paths.js';

export interface CorrelationResult {
  overdeckManaged: boolean;
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
export function buildCorrelationMapSync(
  jsonlPaths: string[],
  sessionIdsByPath: ReadonlyMap<string, string | null | undefined> = new Map(),
): Map<string, CorrelationResult> {
  const db = getOverdeckDatabaseSync();
  const map = new Map<string, CorrelationResult>();

  if (jsonlPaths.length === 0) return map;

  const pathSet = new Set(jsonlPaths);
  const rows = db
    .prepare(
      `SELECT c.name, c.cwd, cf.locator AS claude_session_id, c.issue_id
       FROM conversations c
       JOIN conversation_files cf ON cf.conversation_id = c.id`,
    )
    .all() as Array<{
    name: string;
    cwd: string;
    claude_session_id: string | null;
    issue_id: string | null;
  }>;

  const locatorMap = buildLocatorCorrelationMapFromRows(rows);

  for (const row of rows) {
    const candidatePaths = new Set<string>();
    if (row.claude_session_id) candidatePaths.add(sessionFilePath(row.cwd, row.claude_session_id));

    for (const path of candidatePaths) {
      if (pathSet.has(path)) {
        const existing = map.get(path);
        map.set(path, {
          overdeckManaged: true,
          panIssueId: row.issue_id,
          panAgentId: row.name,
          actualCost: existing?.actualCost ?? null,
          costEventCount: existing?.costEventCount ?? 0,
        });
      }
    }
  }

  for (const [path, sessionId] of sessionIdsByPath) {
    if (!sessionId || !pathSet.has(path)) continue;
    const locatorCorrelation = locatorMap.get(sessionId);
    if (!locatorCorrelation) continue;
    const existing = map.get(path);
    map.set(path, mergeCorrelation(existing, locatorCorrelation));
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
          overdeckManaged: true,
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

export function buildLocatorCorrelationMapSync(): Map<string, CorrelationResult> {
  const db = getOverdeckDatabaseSync();
  const rows = db
    .prepare(
      `SELECT c.name, cf.locator, c.issue_id
       FROM conversations c
       JOIN conversation_files cf ON cf.conversation_id = c.id
       WHERE cf.locator IS NOT NULL`,
    )
    .all() as Array<{ name: string; locator: string | null; issue_id: string | null }>;
  return buildLocatorCorrelationMapFromRows(rows);
}

function buildLocatorCorrelationMapFromRows(
  rows: Array<{ name: string; locator?: string | null; claude_session_id?: string | null; issue_id: string | null }>,
): Map<string, CorrelationResult> {
  const map = new Map<string, CorrelationResult>();
  for (const row of rows) {
    const locator = row.locator ?? row.claude_session_id;
    if (!locator) continue;
    map.set(locator, {
      overdeckManaged: true,
      panIssueId: row.issue_id,
      panAgentId: row.name,
      actualCost: null,
      costEventCount: 0,
    });
  }
  return map;
}

export function mergeCorrelation(
  base: CorrelationResult | undefined,
  override: CorrelationResult,
): CorrelationResult {
  return {
    overdeckManaged: base?.overdeckManaged === true || override.overdeckManaged,
    panIssueId: base?.panIssueId ?? override.panIssueId,
    panAgentId: base?.panAgentId ?? override.panAgentId,
    actualCost: base?.actualCost ?? override.actualCost,
    costEventCount: base?.costEventCount ?? override.costEventCount,
  };
}

// ─── Effect variant (PAN-1249, additive) ─────────────────────────────────────
//
// Additive Effect wrapper — the existing function is purely synchronous DB
// access, so this is just a sync lift for callers that compose with Effect.

/** Effect variant of buildCorrelationMap — pure sync lift. */
export function buildCorrelationMap(
  jsonlPaths: string[],
): Effect.Effect<Map<string, CorrelationResult>> {
  return Effect.sync(() => buildCorrelationMapSync(jsonlPaths));
}
