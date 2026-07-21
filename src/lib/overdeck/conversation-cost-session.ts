import { getOverdeckDatabaseSync } from './infra.js';

export function findConversationForCostSessionSync(input: {
  sessionId?: string | null;
  agentId?: string | null;
}): { name: string } | null {
  const db = getOverdeckDatabaseSync();
  if (input.sessionId) {
    const row = db.prepare(
      `SELECT c.name
       FROM conversation_files cf
       JOIN conversations c ON c.id = cf.conversation_id
       WHERE cf.locator = ?
       ORDER BY cf.created_at DESC, cf.id DESC
       LIMIT 1`,
    ).get(input.sessionId) as { name: string } | undefined;
    if (row) return { name: row.name };
  }
  if (!input.agentId?.startsWith('conv-')) return null;
  const row = db.prepare(
    `SELECT c.name
     FROM conversations c
     WHERE c.tmux_session = ?
     ORDER BY c.created_at DESC
     LIMIT 1`,
  ).get(input.agentId) as { name: string } | undefined;
  return row ? { name: row.name } : null;
}
