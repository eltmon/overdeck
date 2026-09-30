import { getOverdeckDatabase } from './infra.js';

/**
 * Aggregate each conversation's cost + token usage from the canonical `cost_events`
 * ledger, keyed by session id and joined through `conversation_files`. This is the
 * source of truth for conversation cost: `conversations.total_cost` is only a
 * denormalized cache written when a conversation is opened (via the /messages
 * route), so it reads stale/zero for any conversation not opened since the
 * overdeck.db cutover. The list reads from this ledger so it shows live costs
 * without requiring each conversation to be opened first.
 *
 * Returns a map of conversation id → { cost, tokens }. A conversation predating the
 * ledger has no rows and is simply absent — callers fall back to the cached
 * `total_cost` column for those.
 */
export function getConversationLedgerCosts(): Map<string, { cost: number; tokens: number }> {
  // Keyed by the conversation's rowid, because that is the public `id`
  // {@link LegacyConversation.id} carries (c.rowid AS legacy_id), not the uuid.
  // cost_events.session_id matches conversation_files.locator; a conversation may
  // have several locators (relaunch/clear), so we sum across all of them.
  const rows = getOverdeckDatabase()
    .prepare(
      `SELECT c.rowid AS cid,
              COALESCE(SUM(ce.cost), 0) AS cost,
              COALESCE(SUM(ce.input + ce.output + ce.cache_read + ce.cache_write), 0) AS tokens
       FROM cost_events ce
       JOIN conversation_files cf ON cf.locator = ce.session_id
       JOIN conversations c ON c.id = cf.conversation_id
       GROUP BY c.rowid`,
    )
    .all() as { cid: number; cost: number; tokens: number }[];
  const map = new Map<string, { cost: number; tokens: number }>();
  for (const r of rows) map.set(String(r.cid), { cost: r.cost ?? 0, tokens: r.tokens ?? 0 });
  return map;
}
