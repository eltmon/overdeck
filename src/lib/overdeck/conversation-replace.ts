/**
 * Clear the way for a new conversation row under a name an old row holds.
 *
 * An unlinked old row is deleted with its files. A row that other
 * conversations link to (a successor's parent, a critic's builder, a clear or
 * handoff target) cannot be deleted: the foreign keys refuse it. It is kept
 * under a retired name, archived and detached from its session, so the links
 * and its transcript survive. `pan flywheel start --fresh` failed with
 * "FOREIGN KEY constraint failed" once the old flywheel had a successor.
 *
 * Call it inside the transaction that inserts the new row.
 *
 * `retireConversationName` keeps an unlinked row the same way on purpose:
 * `pan flywheel start` retires the previous flywheel run before creating the
 * new one, so its transcript survives the replace (PAN-5666).
 */
import type { SqliteDatabase } from '../database/driver.js';

export function vacateConversationName(db: SqliteDatabase, name: string, now: number): void {
  const linked = db.prepare(`
    SELECT old.id FROM conversations old WHERE old.name = ? AND EXISTS (
      SELECT 1 FROM conversations c WHERE c.parent_conversation_id = old.id OR c.critic_of_conversation_id = old.id
        OR c.cleared_to_conv_id = old.id OR c.handoff_target_conv_id = old.id)
  `).get(name) as { id: string } | undefined;
  if (linked) {
    db.prepare(`
      UPDATE conversations SET name = ?, tmux_session = NULL, archived_at = COALESCE(archived_at, ?) WHERE id = ?
    `).run(retiredConversationName(name, linked.id), now, linked.id);
  }
  db.prepare(`DELETE FROM conversation_files WHERE conversation_id IN (SELECT id FROM conversations WHERE name = ?)`).run(name);
  db.prepare(`DELETE FROM conversations WHERE name = ?`).run(name);
}

/** The `~` suffix a retired row's name carries: `<name>~<first 8 of its uuid>`. */
export function retiredConversationName(name: string, id: string): string {
  return `${name}~${id.slice(0, 8)}`;
}

/**
 * Keep the row `name` holds under its retired name instead of letting the next
 * `createConversation(name)` delete it (PAN-5666). The row is archived, marked
 * ended and detached from its session, and keeps its `claude_session_id` and
 * `conversation_files`, so its transcript still resolves. `pan flywheel start`
 * retires the previous flywheel run this way so status can read its last tick.
 * Returns the retired name, or null when no row holds `name`.
 */
export function retireConversationName(db: SqliteDatabase, name: string, now: number): string | null {
  const row = db.prepare(`SELECT id FROM conversations WHERE name = ?`).get(name) as { id: string } | undefined;
  if (!row) return null;
  const retired = retiredConversationName(name, row.id);
  db.prepare(`
    UPDATE conversations
    SET name = ?, tmux_session = NULL, archived_at = COALESCE(archived_at, ?),
        status = 'ended', ended_at = COALESCE(ended_at, ?)
    WHERE id = ?
  `).run(retired, now, now, row.id);
  return retired;
}
