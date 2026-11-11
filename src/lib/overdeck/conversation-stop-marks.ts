/**
 * Deliberate conversation stops, in memory (PAN-5091).
 *
 * After a terminal-backend restart every conversation row reads `ended`, so the
 * row cannot tell a conversation the restart stopped from one the operator
 * stopped or paused on purpose. The stop doors (the Stop route, `pan flywheel
 * pause`, a lane reap) record the time here, and the restart recovery offer
 * leaves out any conversation stopped on purpose since the backend went down.
 *
 * A leaf module: it imports nothing, so the stop doors and the recovery service
 * can both import it without an import cycle. It is in memory only, like the
 * offer it serves; a dashboard restart forgets both.
 */

/** Marks older than this are dropped when a new one is written. */
const MARK_TTL_MS = 24 * 60 * 60_000;

const stoppedAt = new Map<string, number>();

/** Record that `name` was stopped on purpose at `atMs`. */
export function recordConversationStop(name: string, atMs: number = Date.now()): void {
  for (const [key, at] of stoppedAt) if (atMs - at > MARK_TTL_MS) stoppedAt.delete(key);
  stoppedAt.set(name, atMs);
}

/** True when `name` was stopped on purpose at or after `sinceMs`. */
export function conversationStoppedSince(name: string, sinceMs: number): boolean {
  const at = stoppedAt.get(name);
  return at !== undefined && at >= sinceMs;
}

/** Test seam. */
export function _resetConversationStopMarksForTests(): void {
  stoppedAt.clear();
}
