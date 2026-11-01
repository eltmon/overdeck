/**
 * `GET /api/conversations` with linked machines' conversations (PAN-4650 WI-4,
 * FR-2, D-4650-22).
 *
 * Wraps the local list (with Session Vault browse copies) and, on page 1 only,
 * merges in the `linked_conversations` cache through the pure
 * `mergeConversationRows`. `?linked=0` lists this machine's rows only, for the
 * views that count this machine's runtime.
 */
import { linksSnapshot, type MachineLink } from '../../../lib/anywhere/link-store.js';
import { readEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { getConversationListWithVaultCopies } from '../../../lib/overdeck/conversation-list.js';
import { listLinkedConversations } from '../../../lib/overdeck/linked-conversations.js';
import { type LinkPresence, mergeConversationRows } from '../../../lib/overdeck/linked-conversations-merge.js';
import { currentLinkSupervisor } from './anywhere-boot.js';

type ListRow = Record<string, unknown> & { name: string; origin?: string; claudeSessionId?: string | null };

function presenceOf(link: MachineLink): LinkPresence {
  const status = currentLinkSupervisor()?.status(link.id);
  return status ? { state: status.state, lastSeenAt: status.lastHeartbeatAt } : { state: 'offline', lastSeenAt: null };
}

/** The conversation list for `limit`/`offset`; `params.linked === '0'` leaves linked rows out. */
export async function getMergedConversationList(limit: number, offset: number, params?: URLSearchParams): Promise<readonly unknown[]> {
  const rows = (await getConversationListWithVaultCopies(limit, offset)) as readonly ListRow[];
  if (offset !== 0 || params?.get('linked') === '0') return rows;
  const linked = listLinkedConversations();
  if (linked.length === 0) return rows;
  const identity = await readEnvironmentIdentity();
  return mergeConversationRows({
    local: rows.filter((row) => row.origin !== 'vault'),
    vaultCopies: rows.filter((row) => row.origin === 'vault'),
    linked,
    links: linksSnapshot(),
    selfEnvironmentId: identity?.environmentId ?? null,
    presence: presenceOf,
  });
}
