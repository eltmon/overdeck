/**
 * PAN-4485: a post-/clear chain (parent → sibling → …) shares one terminal
 * session. Only the chain head — the row whose clearedToConvId is null —
 * owns it. A superseded row (clearedToConvId set) owns nothing.
 */
import { getConversationById, type LegacyConversation } from './conversations.js';

type ChainRow = Pick<LegacyConversation, 'id' | 'tmuxSession' | 'clearedToConvId' | 'archivedAt'>;

export function isSupersededConversation(conv: Pick<LegacyConversation, 'clearedToConvId'>): boolean {
  return conv.clearedToConvId != null;
}

const MAX_CLEAR_CHAIN_LENGTH = 64;

/** The row that owns `conv`'s terminal session, or null when the chain is broken. */
export function resolveClearChainHead<T extends ChainRow>(
  conv: T,
  lookup: (id: number) => T | null = getConversationById as unknown as (id: number) => T | null,
): T | null {
  const seen = new Set<number>([conv.id]);
  let current = conv;
  while (current.clearedToConvId != null) {
    const next = lookup(current.clearedToConvId);
    if (!next || next.archivedAt || next.tmuxSession !== conv.tmuxSession) return null;
    if (seen.has(next.id) || seen.size >= MAX_CLEAR_CHAIN_LENGTH) return null;
    seen.add(next.id);
    current = next;
  }
  return current;
}

/** One row per terminal session: superseded rows dropped, first row per session kept (input order). */
export function sessionOwners<T extends Pick<LegacyConversation, 'tmuxSession' | 'clearedToConvId'>>(rows: readonly T[]): T[] {
  const owners = new Map<string, T>();
  for (const row of rows) {
    if (isSupersededConversation(row) || owners.has(row.tmuxSession)) continue;
    owners.set(row.tmuxSession, row);
  }
  return [...owners.values()];
}
