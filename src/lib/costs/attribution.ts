import { FLYWHEEL_CONVERSATION_SESSION } from '../flywheel/constants.js';
import { findConversationForCostSession } from '../overdeck/conversations.js';
import { getOverdeckDatabase } from '../overdeck/infra.js';

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

// PAN-3964 renamed the Flywheel conversation from flywheel-orchestrator to
// conv-flywheel; retired runs get renamed again with a ~<suffix> by
// vacateConversationName (src/lib/overdeck/conversation-replace.ts).
const LEGACY_FLYWHEEL_CONVERSATION = 'flywheel-orchestrator';

function isFlywheelConversationName(name: string): boolean {
  return (
    name === FLYWHEEL_CONVERSATION_SESSION ||
    name.startsWith(`${FLYWHEEL_CONVERSATION_SESSION}~`) ||
    name === LEGACY_FLYWHEEL_CONVERSATION
  );
}

export function classifySessionBucket(
  input: { sessionId?: string | null; agentId?: string | null },
  lookup: ConversationSessionLookup,
): NoIssueBucket {
  const conversation = lookup(input);
  if (!conversation) return NO_ISSUE_BUCKETS.unattributed;
  if (isFlywheelConversationName(conversation.name)) return NO_ISSUE_BUCKETS.flywheel;
  return NO_ISSUE_BUCKETS.conversations;
}

interface UnknownCostSessionRow {
  sessionId: string | null;
  agentId: string | null;
}

export function reclassifyUnknownCostEvents(): { updated: number } {
  const db = getOverdeckDatabase();
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
    const bucket = classifySessionBucket(row, findConversationForCostSession);
    const result = update.run(bucket, row.sessionId, row.agentId);
    updated += result.changes;
  }
  return { updated };
}
