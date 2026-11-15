/**
 * PAN-5353: Send now — flush a queued composer message into a running
 * Claude Code turn by pressing the send-now chord in the agent's pane.
 */
import { toast } from 'sonner';

import { enqueueConversationSend } from './composerSendQueue.js';

// Same ceiling as the message POST (composerSend.ts, 120 s). The client must not
// abort while the server may still be pressing ensure-main keys or the chord:
// an early abort frees the send queue, and the next paste could land mid-press
// (the same reason Cancel never aborts, docs/DASHBOARD-ARCHITECTURE.md).
const SEND_NOW_TIMEOUT_MS = 120_000;

/** POST the send-now route. Throws Error(body.error) on a non-2xx answer. */
export async function requestSendNow(conversationName: string, agentId?: string): Promise<void> {
  const endpoint = agentId
    ? `/api/agents/${encodeURIComponent(agentId)}/send-now`
    : `/api/conversations/${encodeURIComponent(conversationName)}/send-now`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_NOW_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: unknown } | null;
      throw new Error(typeof body?.error === 'string' ? body.error : `Send now failed (${res.status})`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Run Send now on the conversation's send queue; a failure becomes a toast. Never rejects. */
export function sendNowQueued(conversationName: string, agentId?: string): Promise<void> {
  return enqueueConversationSend(conversationName, () => requestSendNow(conversationName, agentId))
    .catch((err: unknown) => { toast.error(err instanceof Error ? err.message : 'Send now failed'); });
}
