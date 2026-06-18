/**
 * G5 — PAN-1937 conversation-metadata export/import.
 *
 * Copies the irreplaceable metadata set from panopticon.db into overdeck.db.
 * The `conversations` row IS the source of truth (no git mirror); this export
 * is the only cross-wipe durability path for that metadata.
 *
 * What it does:
 *   1. Reads `conversations` + `favorites` from the legacy panopticon.db.
 *   2. Generates a UUID for each conversation's new `id` (legacy uses INTEGER PK).
 *   3. Builds a legacy-integer → UUID map so lineage edges resolve correctly.
 *   4. Synthesises a `conversation_files` row for each conversation that has a
 *      `claude_session_id` — panopticon.db has no such table; the pointer lived
 *      in the `claude_session_id` column directly.
 *   5. Writes everything to overdeck.db inside a single atomic transaction.
 *      Uses INSERT OR IGNORE so re-running is safe (idempotent per name).
 *
 * JSONL backing files are NEVER touched — this function only reads/writes DBs.
 */
import { randomUUID } from 'node:crypto';

import { openDatabase } from '../database/driver.js';

export interface ConversationExportResult {
  conversations: number;
  favorites: number;
  conversationFiles: number;
}

interface LegacyConversation {
  id: number;
  name: string;
  cwd: string;
  issue_id: string | null;
  claude_session_id: string | null;
  title: string | null;
  title_source: string | null;
  model: string | null;
  effort: string | null;
  harness: string | null;
  created_at: string;
  archived_at: string | null;
  handoff_doc_path: string | null;
  handoff_target_conv_id: number | null;
  cleared_to_conv_id: number | null;
}

interface LegacyFavorite {
  type: string;
  item_id: string;
  created_at: string;
}

function toMillis(isoString: string): number {
  return new Date(isoString).getTime();
}

/**
 * Copies conversation metadata from a legacy panopticon.db into an already-
 * initialised overdeck.db.  Both databases must already exist on disk.
 *
 * Idempotent — duplicate rows are silently ignored (INSERT OR IGNORE).
 * Returns the count of rows written in each table.
 */
export function exportLegacyConversations(
  legacyDbPath: string,
  overdeckDbPath: string,
): ConversationExportResult {
  const legacy = openDatabase(legacyDbPath);
  const overdeck = openDatabase(overdeckDbPath);

  try {
    const legacyConvs = legacy
      .prepare(
        `SELECT id, name, cwd, issue_id, claude_session_id, title, title_source,
                model, effort, harness, created_at, archived_at, handoff_doc_path,
                handoff_target_conv_id, cleared_to_conv_id
         FROM conversations ORDER BY id`,
      )
      .all<LegacyConversation>();

    // Build legacy INTEGER id → new UUID map so lineage edges resolve correctly
    // after the PK type changes from INTEGER to TEXT.
    const idMap = new Map<number, string>();
    for (const conv of legacyConvs) {
      idMap.set(conv.id, randomUUID());
    }

    const legacyFavs = legacy
      .prepare(`SELECT type, item_id, created_at FROM favorites`)
      .all<LegacyFavorite>();

    let conversationFiles = 0;

    // Write atomically; rollback on any error so overdeck.db stays consistent.
    overdeck.transaction(() => {
      const insertConv = overdeck.prepare(`
        INSERT OR IGNORE INTO conversations
          (id, name, cwd, issue_id, harness, model, effort, title, title_source,
           created_at, archived_at, handoff_doc_path, handoff_target_conv_id, cleared_to_conv_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // panopticon.db has no conversation_files table; the backing-file pointer
      // was carried in conversations.claude_session_id directly.  Each row with
      // a claude_session_id becomes one conversation_files entry (locator = UUID).
      const insertFile = overdeck.prepare(`
        INSERT OR IGNORE INTO conversation_files (conversation_id, harness, locator, created_at)
        VALUES (?, ?, ?, ?)
      `);

      const insertFav = overdeck.prepare(`
        INSERT OR IGNORE INTO favorites (type, item_id, created_at)
        VALUES (?, ?, ?)
      `);

      for (const conv of legacyConvs) {
        const newId = idMap.get(conv.id)!;
        const createdAt = toMillis(conv.created_at);
        const archivedAt = conv.archived_at ? toMillis(conv.archived_at) : null;
        // Resolve lineage edges from INTEGER to UUID; null if the target is missing
        // (should not happen on a healthy DB, but be defensive).
        const handoffTargetConvId =
          conv.handoff_target_conv_id !== null
            ? (idMap.get(conv.handoff_target_conv_id) ?? null)
            : null;
        const clearedToConvId =
          conv.cleared_to_conv_id !== null
            ? (idMap.get(conv.cleared_to_conv_id) ?? null)
            : null;

        const { changes } = insertConv.run(
          newId,
          conv.name,
          conv.cwd,
          conv.issue_id,
          conv.harness,
          conv.model,
          conv.effort,
          conv.title,
          conv.title_source,
          createdAt,
          archivedAt,
          conv.handoff_doc_path,
          handoffTargetConvId,
          clearedToConvId,
        );

        // Only insert conversation_files if the conversation row was actually
        // created (changes > 0).  If the conversation was already present
        // (INSERT OR IGNORE silently skipped it), the FK reference newId would
        // not exist in conversations and the file insert would fail.
        if (changes > 0 && conv.claude_session_id) {
          insertFile.run(
            newId,
            conv.harness ?? 'claude-code',
            conv.claude_session_id,
            createdAt,
          );
          conversationFiles++;
        }
      }

      for (const fav of legacyFavs) {
        insertFav.run(fav.type, fav.item_id, toMillis(fav.created_at));
      }
    })();

    return {
      conversations: legacyConvs.length,
      favorites: legacyFavs.length,
      conversationFiles,
    };
  } finally {
    legacy.close();
    overdeck.close();
  }
}
