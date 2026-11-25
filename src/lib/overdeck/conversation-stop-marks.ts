/**
 * Deliberate conversation stops, on the conversation row (PAN-5091, PAN-5673).
 *
 * After a terminal-backend restart or a host reboot every conversation row
 * reads `ended`, so `status` and `ended_at` cannot tell a conversation the
 * restart stopped from one the operator stopped or paused on purpose. The stop
 * doors (the Stop route, `pan flywheel pause`/`stop`/`abort`, a lane stop or
 * reap) record the time in `conversations.stopped_on_purpose_at`. Two readers
 * act on it: the restart recovery offer leaves out a conversation stopped on
 * purpose since the backend went down, and the Flywheel watchdog's reboot
 * resume refuses a Flywheel stopped on purpose since the boot.
 *
 * Operator intent cannot be derived from git, the tracker, the PR or the
 * terminal backend, so it is stored. It lives on the row, not in process
 * memory, so a dashboard restart keeps it and a stop from any process counts.
 * A successful resume or restart clears it (`clearConversationStop`); a new
 * row starts clear, and `reactivateConversationForSpawn` clears it too.
 * Liveness observations (`markConversationRunning`, `markConversationActive`)
 * never clear it: a stopped pane's harness can stay up for a while.
 */
import { getOverdeckDatabase } from './infra.js';

/** Record that `name` was stopped on purpose at `atMs`; no-op when the row does not exist. */
export function recordConversationStop(name: string, atMs: number = Date.now()): void {
  getOverdeckDatabase()
    .prepare('UPDATE conversations SET stopped_on_purpose_at = ? WHERE name = ?')
    .run(atMs, name);
}

/** Forget a deliberate stop: the conversation was resumed or started again. */
export function clearConversationStop(name: string): void {
  getOverdeckDatabase()
    .prepare('UPDATE conversations SET stopped_on_purpose_at = NULL WHERE name = ? AND stopped_on_purpose_at IS NOT NULL')
    .run(name);
}

/** True when `name` was stopped on purpose at or after `sinceMs`. */
export function conversationStoppedSince(name: string, sinceMs: number): boolean {
  const row = getOverdeckDatabase()
    .prepare('SELECT stopped_on_purpose_at FROM conversations WHERE name = ?')
    .get<{ stopped_on_purpose_at: number | null }>(name);
  const at = row?.stopped_on_purpose_at;
  return typeof at === 'number' && at >= sinceMs;
}
