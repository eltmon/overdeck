/**
 * Eaten-by-compaction watcher for conversation message delivery (PAN-1635 /
 * PAN-1769).
 *
 * Submitting a prompt into a near-full Claude Code context triggers
 * submit-time compaction, and the paste+Enter races the compaction
 * state-transition: the prompt is dropped — it lands nowhere, not in the
 * JSONL, not as a queued command (conv 2596 2026-06-06, conv 2701
 * 2026-06-11). The frontend retry outbox only *surfaces* the loss, and only
 * while the panel is mounted; nothing redelivered the message.
 *
 * This watcher closes that gap server-side. After a conversation message is
 * delivered, it polls the transcript from the pre-delivery byte offset:
 *
 * - the message's own user record lands → done;
 * - a compact_boundary lands without the message → the prompt was eaten;
 *   redeliver ONCE after a short grace (newer Claude builds can queue input
 *   across a compaction — the grace lets a queued prompt land before we send
 *   a duplicate);
 * - neither within the window → give up silently. A plain timeout is NOT
 *   evidence of an eaten message (a stale claudeSessionId reads the wrong
 *   file); blind redelivery would duplicate, so the frontend stall detector
 *   stays the fallback for that case.
 */

import { deliverAgentMessage } from '../../../lib/agents.js';
import { probeTranscriptSince } from '../../../lib/transcript-landing.js';

const WATCH_TIMEOUT_MS = 5 * 60_000;
const WATCH_INTERVAL_MS = 3_000;
const REDELIVERY_GRACE_MS = 10_000;

export type EatenMessageWatchOutcome = 'landed' | 'redelivered' | 'redelivery-failed' | 'unverified';

export interface EatenMessageWatchArgs {
  conversationName: string;
  tmuxSession: string;
  cwd: string;
  sessionId: string;
  /** The delivered message text, used for content-matched landing detection. */
  message: string;
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux';
  /** Transcript byte offset captured BEFORE the original delivery. */
  fromByteOffset: number;
  timeoutMs?: number;
  intervalMs?: number;
  graceMs?: number;
  deliver?: typeof deliverAgentMessage;
  probe?: typeof probeTranscriptSince;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function watchForEatenConversationMessage(
  args: EatenMessageWatchArgs,
): Promise<EatenMessageWatchOutcome> {
  const deliver = args.deliver ?? deliverAgentMessage;
  const probe = args.probe ?? probeTranscriptSince;
  const timeoutMs = args.timeoutMs ?? WATCH_TIMEOUT_MS;
  const intervalMs = args.intervalMs ?? WATCH_INTERVAL_MS;
  const graceMs = args.graceMs ?? REDELIVERY_GRACE_MS;

  const deadline = Date.now() + timeoutMs;
  let boundarySeenAt: number | null = null;
  let redelivered = false;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const result = await probe(args.cwd, args.sessionId, args.fromByteOffset, args.message);
    if (result.matchedUserRecord) {
      return redelivered ? 'redelivered' : 'landed';
    }
    if (redelivered || result.compactBoundaryCount === 0) continue;
    boundarySeenAt ??= Date.now();
    if (Date.now() - boundarySeenAt < graceMs) continue;
    console.warn(
      `[conversation-eaten-message-watcher] ${args.conversationName}: compact boundary landed without the ` +
      `delivered message — submit-time compaction ate it; redelivering once (PAN-1635).`,
    );
    try {
      await deliver(args.tmuxSession, args.message, 'conversation-message-redelivery', args.deliveryMethod);
      redelivered = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[conversation-eaten-message-watcher] ${args.conversationName}: redelivery failed: ${msg}`);
      return 'redelivery-failed';
    }
  }

  return 'unverified';
}
