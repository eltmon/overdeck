/**
 * Tracks tmux sessions that are mid-respawn so that `/ws/terminal`
 * reconnects landing in the kill→spawn gap don't get a fatal 4404.
 *
 * Background: switch-model, resume, and restart-all all do
 *
 *     await killSessionAsync(name)   // old tmux dies, PTY exits,
 *                                    // ws-terminal closes clients with 1000
 *     await spawnConversationSession(...)   // new tmux session with same name
 *     await waitForTmuxSession(name)
 *     await waitForReadySignal(name, 30)        // up to 30s
 *
 * The terminal frontend (`XTerminal.tsx`) reconnects on close 1000 with
 * exponential backoff (1s, 2s, 4s, 8s, 16s). Every reconnect re-enters
 * `ws-terminal.ts`, which checks the tmux session list upfront and
 * `close(4404, 'session-not-found')` if the name isn't there yet.
 * 4404 is treated as fatal on the client (no retry — the session is
 * presumed gone), so the panel sticks on "Could not reconnect" even
 * after the respawn completes a moment later.
 *
 * This registry lets `ws-terminal.ts` distinguish "transient absence
 * during respawn" from "session is actually gone". Respawn sites mark
 * the name with `markRespawnPending()` for the duration of their kill+
 * spawn block; ws-terminal calls `waitForSessionRespawn()` instead of
 * 4404-ing immediately when the session is missing AND
 * `isRespawnPending()` is true.
 */

import { conversationSessionAlive } from '../../../lib/overdeck/conversation-liveness.js';

/** Session name → the in-flight respawn's mark (when it began, epoch ms). */
const pendingRespawns = new Map<string, { readonly startedAtMs: number }>();

/**
 * Mark a tmux session as mid-respawn. The returned `done()` must run in
 * a `finally` so the marker is cleared even if the respawn throws. A
 * `done()` only clears its own mark, never a later overlapping respawn's.
 */
export function markRespawnPending(sessionName: string): { done: () => void } {
  const mark = { startedAtMs: Date.now() };
  pendingRespawns.set(sessionName, mark);
  return {
    done: () => {
      if (pendingRespawns.get(sessionName) === mark) pendingRespawns.delete(sessionName);
    },
  };
}

/** True if a respawn is currently in progress for this session name. */
export function isRespawnPending(sessionName: string): boolean {
  return pendingRespawns.has(sessionName);
}

/**
 * When the in-flight respawn of this session began (epoch ms), or null when
 * none is in flight. A harness launched before this instant belongs to the
 * generation the respawn is replacing (PAN-3962).
 */
export function respawnStartedAt(sessionName: string): number | null {
  return pendingRespawns.get(sessionName)?.startedAtMs ?? null;
}

const POLL_INTERVAL_MS = 200;

/**
 * Poll for the session to come back, up to `timeoutMs`. Returns whether
 * it did. Bails early once `pendingRespawns` no longer contains the name
 * (the wrapping respawn block finished, success or failure) and the
 * session still isn't there — at that point the absence is real.
 *
 * `timeoutMs` should comfortably exceed the longest respawn window. The
 * dominant cost is `waitForReadySignal`'s 30s ceiling in the conversation
 * routes, so 35s is the right default for those callers.
 */
export async function waitForSessionRespawn(
  sessionName: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await conversationSessionAlive(sessionName)) return true;
    if (!pendingRespawns.has(sessionName)) {
      return conversationSessionAlive(sessionName);
    }
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return conversationSessionAlive(sessionName);
}
