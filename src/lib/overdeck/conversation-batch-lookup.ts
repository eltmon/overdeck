import { getOverdeckDatabase } from './infra.js';

/**
 * Batched conversation lookup by Claude session id (PAN-4358 review fix).
 *
 * `getConversationByClaudeSessionId()` in conversations.ts runs one query per
 * call; resolving the palette's 300-chunk candidate pool one root at a time
 * cost 250-500ms of synchronous better-sqlite3 work on the dashboard server
 * (most roots miss — agent/specialist/unregistered sessions have no
 * conversation row — and a miss scans every conversation row). This module
 * resolves every distinct root in one query instead.
 */

const SQLITE_MAX_PARAMS = 500;

export interface ConversationBatchLookupRow {
  name: string;
  projectKey: string | null;
  title: string | null;
  archived: boolean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** One row per matching `locator`; a locator with no conversation row is absent from the map. */
export function resolveConversationsByClaudeSessionIds(sessionIds: string[]): Map<string, ConversationBatchLookupRow> {
  const distinct = [...new Set(sessionIds)];
  const results = new Map<string, ConversationBatchLookupRow>();
  if (distinct.length === 0) return results;

  const db = getOverdeckDatabase();
  for (const batch of chunk(distinct, SQLITE_MAX_PARAMS)) {
    const placeholders = batch.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT cf.locator AS locator, c.name AS name, c.project_key AS project_key,
                c.title AS title, c.archived_at AS archived_at
         FROM conversation_files cf
         JOIN conversations c ON c.id = cf.conversation_id
         WHERE cf.locator IN (${placeholders})`,
      )
      .all(...batch) as Array<{
        locator: string;
        name: string;
        project_key: string | null;
        title: string | null;
        archived_at: number | null;
      }>;
    for (const row of rows) {
      results.set(row.locator, {
        name: row.name,
        projectKey: row.project_key,
        title: row.title,
        archived: row.archived_at != null,
      });
    }
  }
  return results;
}
