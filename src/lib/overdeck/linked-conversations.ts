/**
 * Door for the linked-conversations cache (PAN-4650 WI-1, D-4650-1).
 *
 * The only module that reads or writes `linked_conversations`. Each row is one
 * conversation another machine (the owner) shares with this machine. The
 * owner's answer to `GET /api/machines/conversations` is the only writer: the
 * viewer sync service passes the whole answer to `replaceLinkedConversations`,
 * which upserts every row in it and deletes that environment's rows the answer
 * no longer names, in one transaction. The list route merges the cache into
 * the local list at read time; nothing here touches `conversations`.
 */

import type { SharedConversationRow } from '@overdeck/contracts';

import { getOverdeckDatabase } from './infra.js';

export interface LinkedConversationRecord {
  /** `linked_conversations` rowid; the merged list uses its negative as the row id. */
  id: number;
  environmentId: string;
  /** The owner's conversation name. */
  name: string;
  row: SharedConversationRow;
  nativeSessionId: string | null;
  cachedAt: string;
  listHash: string;
}

interface LinkedRow {
  id: number;
  environment_id: string;
  name: string;
  row_json: string;
  native_session_id: string | null;
  cached_at: string;
  list_hash: string;
}

/**
 * Hash of the last answer per environment for answers with no rows (sharing
 * off, or an owner with no conversations), which leave no row to carry it.
 * Memory only: after a restart the viewer refetches on connect anyway.
 */
const emptyAnswerHashes = new Map<string, string>();

const SELECT_ROW = 'SELECT id, environment_id, name, row_json, native_session_id, cached_at, list_hash FROM linked_conversations';

function toRecord(row: LinkedRow): LinkedConversationRecord {
  return {
    id: row.id,
    environmentId: row.environment_id,
    name: row.name,
    row: JSON.parse(row.row_json) as SharedConversationRow,
    nativeSessionId: row.native_session_id,
    cachedAt: row.cached_at,
    listHash: row.list_hash,
  };
}

/** Make the cache for `environmentId` exactly `rows`, stamped with `hash`. */
export function replaceLinkedConversations(
  environmentId: string,
  rows: readonly SharedConversationRow[],
  hash: string,
  now: Date = new Date(),
): void {
  const db = getOverdeckDatabase();
  const cachedAt = now.toISOString();
  db.transaction(() => {
    const upsert = db.prepare(`
      INSERT INTO linked_conversations (environment_id, name, row_json, native_session_id, cached_at, list_hash)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(environment_id, name) DO UPDATE SET
        row_json = excluded.row_json,
        native_session_id = excluded.native_session_id,
        cached_at = excluded.cached_at,
        list_hash = excluded.list_hash
    `);
    for (const row of rows) {
      upsert.run(environmentId, row.name, JSON.stringify(row), row.nativeSessionId, cachedAt, hash);
    }
    const kept = new Set(rows.map((row) => row.name));
    const existing = db.prepare('SELECT name FROM linked_conversations WHERE environment_id = ?').all<{ name: string }>(environmentId);
    const remove = db.prepare('DELETE FROM linked_conversations WHERE environment_id = ? AND name = ?');
    for (const { name } of existing) {
      if (!kept.has(name)) remove.run(environmentId, name);
    }
  })();
  if (rows.length === 0) emptyAnswerHashes.set(environmentId, hash);
  else emptyAnswerHashes.delete(environmentId);
}

/**
 * Every cached row, ordered by environment then owner name. `readOnly` is for
 * readers outside the dashboard (the deacon child's Fly machine sweep), which
 * must not open the dashboard-owned database for writing.
 */
export function listLinkedConversations(options: { readOnly?: boolean } = {}): LinkedConversationRecord[] {
  return getOverdeckDatabase(undefined, options)
    .prepare(`${SELECT_ROW} ORDER BY environment_id, name`)
    .all<LinkedRow>()
    .map(toRecord);
}

export function getLinkedConversation(environmentId: string, name: string): LinkedConversationRecord | null {
  const row = getOverdeckDatabase()
    .prepare(`${SELECT_ROW} WHERE environment_id = ? AND name = ?`)
    .get<LinkedRow>(environmentId, name);
  return row ? toRecord(row) : null;
}

export function deleteLinkedConversationsFor(environmentId: string): void {
  emptyAnswerHashes.delete(environmentId);
  getOverdeckDatabase().prepare('DELETE FROM linked_conversations WHERE environment_id = ?').run(environmentId);
}

/** The list hash of the last answer cached for `environmentId`, or null when nothing is cached. */
export function cachedListHash(environmentId: string): string | null {
  const row = getOverdeckDatabase()
    .prepare('SELECT list_hash FROM linked_conversations WHERE environment_id = ? LIMIT 1')
    .get<{ list_hash: string }>(environmentId);
  return row?.list_hash ?? emptyAnswerHashes.get(environmentId) ?? null;
}

/** Environments with anything cached (rows, or the hash of an answer with no rows). */
export function linkedConversationEnvironmentIds(): string[] {
  const rows = getOverdeckDatabase()
    .prepare('SELECT DISTINCT environment_id FROM linked_conversations')
    .all<{ environment_id: string }>();
  return [...new Set([...rows.map((row) => row.environment_id), ...emptyAnswerHashes.keys()])];
}
