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
import { listRemoteLanes } from '../../../lib/lanes/remote-lanes.js';
import { type LinkPresence, mergeConversationRows, remoteLaneKey, type RemoteLaneEntry } from '../../../lib/overdeck/linked-conversations-merge.js';

type ListRow = Record<string, unknown> & { name: string; origin?: string; claudeSessionId?: string | null };

/** A link's live status; the link supervisor, set by anywhere-boot (a setter, so this module never imports the boot module). */
export interface LinkPresenceSource {
  status(linkId: string): { state: LinkPresence['state']; lastHeartbeatAt: string | null } | null;
}

let presenceSource: LinkPresenceSource | null = null;

export function setLinkPresenceSource(source: LinkPresenceSource | null): void {
  presenceSource = source;
}

function presenceOf(link: MachineLink): LinkPresence {
  const status = presenceSource?.status(link.id);
  return status ? { state: status.state, lastSeenAt: status.lastHeartbeatAt } : { state: 'offline', lastSeenAt: null };
}

/** The conversation list for `limit`/`offset`; `params.linked === '0'` leaves linked rows out. */
export async function getMergedConversationList(limit: number, offset: number, params?: URLSearchParams): Promise<readonly unknown[]> {
  const rows = (await getConversationListWithVaultCopies(limit, offset)) as readonly ListRow[];
  if (offset !== 0 || params?.get('linked') === '0') return rows;
  const linked = listLinkedConversations();
  if (linked.length === 0) return rows;
  const identity = await readEnvironmentIdentity();
  // PAN-4638 FR-8: remote lanes nest under the orchestrator that launched them.
  const remoteLanes = new Map<string, RemoteLaneEntry>();
  for (const { facts, archivedAt } of await listRemoteLanes({}).catch(() => [])) {
    if (archivedAt !== null) continue;
    remoteLanes.set(remoteLaneKey(facts.environmentId, facts.name), {
      parentName: facts.parentName, run: facts.run, key: facts.key, role: facts.role, criticOfName: facts.criticOfName, projectKey: facts.projectKey,
    });
  }
  return mergeConversationRows({
    local: rows.filter((row) => row.origin !== 'vault'),
    vaultCopies: rows.filter((row) => row.origin === 'vault'),
    linked,
    links: linksSnapshot(),
    selfEnvironmentId: identity?.environmentId ?? null,
    presence: presenceOf,
    remoteLanes,
  });
}
