/**
 * Conversation Lifecycle Polling Service (PAN-416)
 *
 * Runs every 10 seconds to check whether active tmux sessions still exist.
 * Marks conversations as 'ended' in SQLite when their tmux session is gone.
 * This drives the status dot update in the ConversationList UI.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { listConversations, markConversationEnded } from '../../../lib/database/conversations-db.js';

const execAsync = promisify(exec);

const POLL_INTERVAL_MS = 10_000;

let pollTimer: ReturnType<typeof setTimeout> | null = null;

async function tmuxSessionExists(sessionName: string): Promise<boolean> {
  try {
    await execAsync(`tmux has-session -t ${sessionName} 2>/dev/null`, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

async function pollOnce(): Promise<void> {
  try {
    const conversations = listConversations();
    const active = conversations.filter(c => c.status === 'active');

    await Promise.all(
      active.map(async (conv) => {
        const alive = await tmuxSessionExists(conv.tmuxSession);
        if (!alive) {
          console.log(`[conversation-lifecycle] Session ${conv.tmuxSession} gone — marking ended`);
          markConversationEnded(conv.name);
        }
      }),
    );
  } catch (err: unknown) {
    // Don't crash the server on poll errors
    console.error('[conversation-lifecycle] Poll error:', err);
  }
}

function scheduleNext(): void {
  pollTimer = setTimeout(async () => {
    await pollOnce();
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
