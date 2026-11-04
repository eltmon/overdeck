/**
 * PAN-4651 D-4651-1: which linked machine started a conversation.
 *
 * A work door (`/api/machines/work/*`) stamps the asking machine's environment
 * id on the row it created; nothing else writes `started_by_environment_id`.
 * The agent fence (`link-fence.ts`) reads it to let an agent on that machine
 * change the conversation it started, and only that one. Null means the row
 * was started on this machine.
 */
import { getOverdeckDatabase } from './infra.js';

/** Stamp the starting machine on a conversation row; no-op when the row does not exist. */
export function markConversationStartedBy(name: string, environmentId: string): void {
  getOverdeckDatabase()
    .prepare('UPDATE conversations SET started_by_environment_id = ? WHERE name = ?')
    .run(environmentId, name);
}

/** The environment id of the linked machine that started this conversation; null for local rows and unknown names. */
export function conversationStartedBy(name: string): string | null {
  const row = getOverdeckDatabase()
    .prepare('SELECT started_by_environment_id FROM conversations WHERE name = ?')
    .get<{ started_by_environment_id: string | null }>(name);
  return row?.started_by_environment_id ?? null;
}
