/**
 * Released conversations (PAN-4650 WI-5, D-8, D-4650-8).
 *
 * A pull releases a conversation on its old owner: `released_to` names the
 * machine that continues it, and this copy stays read-only until the release
 * is undone. `conversationWriteRefusal` is the one check every write door
 * (message, resume, switch-model, compact, plan-action, kickoff) runs right
 * after its lookup, so in-process callers (scheduler, triggers, Flywheel) are
 * refused too. It also covers Session Vault browse copies, which were refused
 * by the resume door alone before.
 */
import { linksSnapshot } from '../anywhere/link-store.js';
import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { isVaultBrowseConversation, vaultBrowseReadOnlyMessage } from './conversation-vault-rows.js';
import type { LegacyConversation } from './conversations.js';
import { getOverdeckDatabase } from './infra.js';

export interface WriteRefusal {
  error: string;
  code: 'vault-browse-copy' | 'conversation-released';
  releasedTo?: string;
}

type RefusalInput = Pick<LegacyConversation, 'name' | 'origin' | 'vaultOwnerLabel' | 'releasedTo'>;

export function markConversationReleased(name: string, toEnvironmentId: string): void {
  getOverdeckDatabase().prepare('UPDATE conversations SET released_to = ? WHERE name = ?').run(toEnvironmentId, name);
}

export function clearConversationRelease(name: string): void {
  getOverdeckDatabase().prepare('UPDATE conversations SET released_to = ? WHERE name = ?').run(null, name);
}

/** The label of the machine a conversation was released to, else the start of its environment id. */
function releasedToLabel(environmentId: string): string {
  return linksSnapshot().find((link) => link.environmentId === environmentId)?.label ?? environmentId.slice(0, 8);
}

/** Why this conversation refuses writes, or null when it accepts them. */
export function conversationWriteRefusalBody(conv: RefusalInput): WriteRefusal | null {
  if (isVaultBrowseConversation(conv)) return { error: vaultBrowseReadOnlyMessage(conv), code: 'vault-browse-copy' };
  if (conv.releasedTo) {
    return {
      error: `Continued on ${releasedToLabel(conv.releasedTo)}; this copy is read-only`,
      code: 'conversation-released',
      releasedTo: conv.releasedTo,
    };
  }
  return null;
}

/** The 409 a write door answers for a read-only conversation, or null. */
export function conversationWriteRefusal(conv: RefusalInput): ReturnType<typeof jsonResponse> | null {
  const body = conversationWriteRefusalBody(conv);
  return body ? jsonResponse(body, { status: 409 }) : null;
}
