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
    `).run(`${name}~${linked.id.slice(0, 8)}`, now, linked.id);
  }
  db.prepare(`DELETE FROM conversation_files WHERE conversation_id IN (SELECT id FROM conversations WHERE name = ?)`).run(name);
  db.prepare(`DELETE FROM conversations WHERE name = ?`).run(name);
}
