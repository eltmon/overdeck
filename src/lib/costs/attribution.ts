import { findConversationForCostSessionSync } from '../overdeck/conversations.js';
import { getOverdeckDatabaseSync } from '../overdeck/infra.js';

export const NO_ISSUE_BUCKETS = {
  conversations: 'CONVERSATIONS',
  flywheel: 'FLYWHEEL',
  unattributed: 'UNATTRIBUTED',
} as const;

export type NoIssueBucket = typeof NO_ISSUE_BUCKETS[keyof typeof NO_ISSUE_BUCKETS];

export type ConversationSessionLookup = (input: {
  sessionId?: string | null;
  agentId?: string | null;
}) => { name: string } | null;

export function classifySessionBucket(
  input: { sessionId?: string | null; agentId?: string | null },
  lookup: ConversationSessionLookup,
): NoIssueBucket {
  const conversation = lookup(input);
  if (!conversation) return NO_ISSUE_BUCKETS.unattributed;
  if (conversation.name === 'flywheel-orchestrator') return NO_ISSUE_BUCKETS.flywheel;
  return NO_ISSUE_BUCKETS.conversations;
}

interface UnknownCostSessionRow {
  sessionId: string | null;
  agentId: string | null;
}

export function reclassifyUnknownCostEventsSync(): { updated: number } {
  const db = getOverdeckDatabaseSync();
  const rows = db.prepare(
    `SELECT DISTINCT session_id AS sessionId, agent_id AS agentId
     FROM cost_events
     WHERE issue_id = 'UNKNOWN'`,
  ).all() as UnknownCostSessionRow[];
  let updated = 0;
  const update = db.prepare(
    `UPDATE cost_events
     SET issue_id = ?
     WHERE issue_id = 'UNKNOWN'
       AND session_id IS ?
       AND agent_id IS ?`,
  );
  for (const row of rows) {
    const bucket = classifySessionBucket(row, findConversationForCostSessionSync);
    const result = update.run(bucket, row.sessionId, row.agentId);
    updated += result.changes;
  }
  return { updated };
}
