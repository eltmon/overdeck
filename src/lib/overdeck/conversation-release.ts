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

/** The machine and native session a conversation was pulled from (D-4650-14). */
export interface PulledFrom {
  environmentId: string;
  nativeSessionId: string;
}

/**
 * Record where a pulled conversation came from. Adoption mints a new native
 * session id, so this is the only link back to the old owner's released row:
 * when that machine pulls the conversation back, the release answer carries
 * it and the old row is archived.
 */
export function markPulledFrom(name: string, from: PulledFrom): void {
  getOverdeckDatabase().prepare('UPDATE conversations SET pulled_from = ? WHERE name = ?').run(JSON.stringify(from), name);
}

function parsePulledFrom(raw: string | null | undefined): PulledFrom | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PulledFrom>;
    return typeof value.environmentId === 'string' && typeof value.nativeSessionId === 'string'
      ? { environmentId: value.environmentId, nativeSessionId: value.nativeSessionId }
      : null;
  } catch {
    return null;
  }
}

export function readPulledFrom(name: string): PulledFrom | null {
  const row = getOverdeckDatabase().prepare('SELECT pulled_from FROM conversations WHERE name = ?').get<{ pulled_from: string | null }>(name);
  return parsePulledFrom(row?.pulled_from);
}

/** Every pulled conversation's origin, by name, in one query (the shared list reads it). */
export function listPulledFrom(): Map<string, PulledFrom> {
  const rows = getOverdeckDatabase()
    .prepare('SELECT name, pulled_from FROM conversations WHERE pulled_from IS NOT NULL')
    .all<{ name: string; pulled_from: string }>();
  const result = new Map<string, PulledFrom>();
  for (const row of rows) {
    const from = parsePulledFrom(row.pulled_from);
    if (from) result.set(row.name, from);
  }
  return result;
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
