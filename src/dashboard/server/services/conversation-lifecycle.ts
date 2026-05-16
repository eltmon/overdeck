/**
 * Conversation Lifecycle Polling Service (PAN-416)
 *
 * Runs every 10 seconds to check whether active tmux sessions still exist.
 * Marks conversations as 'ended' in SQLite when their tmux session is gone.
 * This drives the status dot update in the ConversationList UI.
 */

import { listActiveConversations, markConversationEnded } from '../../../lib/database/conversations-db.js';
import { listSessionNamesAsync } from '../../../lib/tmux.js';
import { cleanupUnreferencedConversationAttachments, runInBatches } from './conversation-attachments.js';

const POLL_INTERVAL_MS = 10_000;
// New conversations that have not yet had time to start their tmux session should
// not be marked ended — the session is still spawning in the background.
const SPAWN_GRACE_PERIOD_MS = 30_000;

let pollTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Poll all active conversations and mark as ended any whose tmux session is gone.
 * Uses a single `tmux list-sessions` call instead of N individual `sessionExists`
 * subprocesses to avoid the N+1 spawn problem.
 */
export async function pollConversations(): Promise<void> {
  try {
    const conversations = listActiveConversations();
    if (conversations.length === 0) return;

    const aliveSessions = new Set(await listSessionNamesAsync());

    const endedConversations: typeof conversations = [];
    const now = Date.now();
    for (const conv of conversations) {
      if (!aliveSessions.has(conv.tmuxSession)) {
        const ageMs = now - new Date(conv.createdAt).getTime();
        if (ageMs < SPAWN_GRACE_PERIOD_MS) continue;
        console.log(`[conversation-lifecycle] Session ${conv.tmuxSession} gone — marking ended`);
        markConversationEnded(conv.name);
        endedConversations.push(conv);
      }
    }
    // Batch attachment cleanup to avoid an unbounded fan-out when many
    // conversations end simultaneously (e.g., after server restart).
    await runInBatches(endedConversations, 5, async (conv) => {
      await cleanupUnreferencedConversationAttachments(conv).catch((err: unknown) => {
        console.error(`[conversation-lifecycle] Cleanup failed for ${conv.name}:`, err);
      });
    });
  } catch (err: unknown) {
    // Don't crash the server on poll errors
    console.error('[conversation-lifecycle] Poll error:', err);
  }
}

function scheduleNext(): void {
  pollTimer = setTimeout(async () => {
    await pollConversations();
    scheduleNext();
  }, POLL_INTERVAL_MS);
}

export function startConversationLifecycleService(): void {
  console.log('[panopticon] ConversationLifecycleService started (10s poll)');
  scheduleNext();
}

export function stopConversationLifecycleService(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
    console.log('[panopticon] ConversationLifecycleService stopped');
  }
}
