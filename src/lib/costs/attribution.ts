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
