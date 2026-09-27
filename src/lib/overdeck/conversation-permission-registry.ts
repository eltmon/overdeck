/**
 * PAN-4278: in-memory record of Claude Code PermissionRequest hooks, per
 * conversation and per agent key (`agent_id ?? 'main'`).
 *
 * The pane is the authority on whether a permission prompt is up
 * (`agents/permission-prompt.ts`); this registry only enriches it with what the
 * pane cannot say — which subagent asked, and when. It is fed by a best-effort
 * `curl --max-time 1` hook, so an entry can go stale when a clearing post is
 * lost; callers never block delivery on a registry entry alone. Nothing is
 * persisted: a dashboard restart empties it and the dialog falls back to the
 * pane parse.
 */

export interface ConversationPermissionEntry {
  readonly agentKey: string;                 // agent_id ?? 'main'
  readonly agentId: string | null;
  readonly agentType: string | null;
  readonly agentDescription: string | null;
  readonly toolName: string;
  readonly toolInputPreview: string;
  readonly requestedAt: string;
}

const entriesByConversation = new Map<string, Map<string, ConversationPermissionEntry>>();
const firstSeenByConversation = new Map<string, { signature: string; at: string }>();

export function recordPermissionRequest(conversationName: string, entry: ConversationPermissionEntry): void {
  let entries = entriesByConversation.get(conversationName);
  if (!entries) {
    entries = new Map();
    entriesByConversation.set(conversationName, entries);
  }
  entries.set(entry.agentKey, entry);
}

export function clearPermissionRequest(conversationName: string, agentKey: string): void {
  const entries = entriesByConversation.get(conversationName);
  if (!entries) return;
  entries.delete(agentKey);
  if (entries.size === 0) entriesByConversation.delete(conversationName);
}

/** Entries for one conversation, oldest request first. */
export function listPermissionRequests(conversationName: string): ConversationPermissionEntry[] {
  const entries = entriesByConversation.get(conversationName);
  if (!entries) return [];
  return [...entries.values()].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/**
 * When a prompt with `signature` was first seen on the conversation's pane.
 * Gives pane-only prompts (no hook entry, e.g. after a restart) a stable
 * "waiting since" across polls; a different signature restarts the clock.
 */
export function firstSeenAt(conversationName: string, signature: string, now: string): string {
  const seen = firstSeenByConversation.get(conversationName);
  if (seen && seen.signature === signature) return seen.at;
  firstSeenByConversation.set(conversationName, { signature, at: now });
  return now;
}

export function resetPermissionRegistryForTests(): void {
  entriesByConversation.clear();
  firstSeenByConversation.clear();
}
