/**
 * Eaten-by-compaction watcher for running Claude Code agents.
 *
 * Submit-time compaction can clear a delivered message from the composer
 * without writing its user record to the transcript. The transport has already
 * accepted the Enter at that point, so composer-only confirmation reports a
 * false success and pipeline feedback remains stranded. A compact boundary
 * without the message's own transcript record is positive evidence of that
 * loss; after a grace period, redeliver once without the original dedup key.
 */

import { probeTranscriptSince } from '../transcript-landing.js';
import { deliverAgentMessage } from './delivery.js';

const WATCH_TIMEOUT_MS = 5 * 60_000;
const WATCH_INTERVAL_MS = 3_000;
const REDELIVERY_GRACE_MS = 10_000;

export type EatenAgentMessageWatchOutcome = 'landed' | 'redelivered' | 'redelivery-failed' | 'unverified';

export interface EatenAgentMessageWatchArgs {
  agentId: string;
  workspace: string;
  sessionId: string;
  message: string;
  caller: string;
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux';
  /** Transcript byte offset captured before the original delivery. */
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

export async function watchForEatenAgentMessage(
  args: EatenAgentMessageWatchArgs,
): Promise<EatenAgentMessageWatchOutcome> {
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
    const result = await probe(
      args.workspace,
      args.sessionId,
      args.fromByteOffset,
      args.message,
    );
    if (result.matchedUserRecord) {
      return redelivered ? 'redelivered' : 'landed';
    }
    if (redelivered || result.compactBoundaryCount === 0) continue;
    boundarySeenAt ??= Date.now();
    if (Date.now() - boundarySeenAt < graceMs) continue;

    console.warn(
      `[agent-eaten-message-watcher] ${args.agentId}: compact boundary landed without the ` +
      'delivered message — submit-time compaction ate it; redelivering once.',
    );
    try {
      // A compact boundary plus an absent content-matched user record proves
      // the original side effect was lost. Redeliver without the completed
      // dedup key, which would otherwise suppress the repair attempt.
      await deliver(
        args.agentId,
        args.message,
        `${args.caller}:compaction-redelivery`,
        args.deliveryMethod,
      );
      redelivered = true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[agent-eaten-message-watcher] ${args.agentId}: redelivery failed: ${message}`);
      return 'redelivery-failed';
    }
  }

  return 'unverified';
}
