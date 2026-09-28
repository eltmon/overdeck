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
/** conversation → agent key → signature of the prompt the pane showed for that entry. */
const seenOnPaneByConversation = new Map<string, Map<string, string>>();

export function recordPermissionRequest(conversationName: string, entry: ConversationPermissionEntry): void {
  let entries = entriesByConversation.get(conversationName);
  if (!entries) {
    entries = new Map();
    entriesByConversation.set(conversationName, entries);
  }
  entries.set(entry.agentKey, entry);
  // A new request from this agent has not been seen on the pane yet.
  seenOnPaneByConversation.get(conversationName)?.delete(entry.agentKey);
}

export function clearPermissionRequest(conversationName: string, agentKey: string): void {
  seenOnPaneByConversation.get(conversationName)?.delete(agentKey);
  const entries = entriesByConversation.get(conversationName);
  if (!entries) return;
  entries.delete(agentKey);
  if (entries.size === 0) entriesByConversation.delete(conversationName);
}

/** The pane showed this entry's prompt (with `signature`). */
export function markPermissionSeenOnPane(conversationName: string, agentKey: string, signature: string): void {
  if (!entriesByConversation.get(conversationName)?.has(agentKey)) return;
  let seen = seenOnPaneByConversation.get(conversationName);
  if (!seen) {
    seen = new Map();
    seenOnPaneByConversation.set(conversationName, seen);
  }
  seen.set(agentKey, signature);
}

/**
 * Drop entries whose prompt the pane showed and no longer shows: they were
 * answered. No hook reliably clears them — a user Deny fires neither
 * PostToolUse nor Stop, and PermissionDenied is the auto-mode classifier's
 * event — so the pane is the evidence. `onScreenSignature` is the prompt on
 * screen now, or null when the pane was read and shows none. Entries never
 * seen on the pane are kept: the prompt may not have drawn yet.
 */
export function pruneAnsweredPermissions(conversationName: string, onScreenSignature: string | null): void {
  const seen = seenOnPaneByConversation.get(conversationName);
  if (!seen) return;
  for (const [agentKey, signature] of [...seen]) {
    if (signature !== onScreenSignature) clearPermissionRequest(conversationName, agentKey);
  }
  if (seen.size === 0) seenOnPaneByConversation.delete(conversationName);
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
  seenOnPaneByConversation.clear();
}
