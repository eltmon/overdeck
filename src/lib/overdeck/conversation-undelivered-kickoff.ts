/**
 * PAN-4242: the first message a respawned conversation gets. A failed fork whose
 * kickoff was never delivered (held by `deliverForkSeed` on a refusal) gets that
 * kickoff, once; every other resume gets the generic resume notice.
 *
 * The kickoff goes through the caller's `deliverKickoff` (`deliverForkSeed`):
 * conversation-forks imports conversation-runtime, which calls this module, so
 * importing the fork module here would be an import cycle. Without a deliverer
 * nothing is claimed, and the kickoff stays held for the Start button.
 *
 * An operator hold (`pan handoff --hold`, fork request `hold: true`) is never
 * claimed here. `forkStatus` is not consulted: resurrecting an ended row resets
 * `failed` to NULL before this runs.
 */
import type { deliverAgentMessage } from '../agents.js';
import { claimHeldKickoff, forkRequestedHold, restoreHeldKickoff } from './conversation-kickoff-store.js';
import { getConversationByName, updateForkStatus, type LegacyConversation as Conversation } from './conversations.js';
import { deliverResumeContractUnlessGated, type ResumeContractDeliveryResult } from './resume-contract-delivery.js';

/** Delivers a fork kickoff to a running conversation; throws when it was not delivered. */
export type KickoffDeliverer = (conv: Conversation, text: string, caller: string) => Promise<void>;

export interface ResumeNotice {
  text: string;
  caller: string;
  method: Parameters<typeof deliverAgentMessage>[3];
  send: boolean;
}

export async function deliverResumeNoticeOrKickoff(
  conv: Conversation,
  notice: ResumeNotice,
  deliverKickoff?: KickoffDeliverer,
): Promise<ResumeContractDeliveryResult> {
  const current = getConversationByName(conv.name) ?? conv;
  const kickoff = deliverKickoff && !forkRequestedHold(current.forkRequest) ? claimHeldKickoff(conv.name) : null;
  if (deliverKickoff && kickoff !== null) {
    try {
      await deliverKickoff(current, kickoff, 'conversation-resume-kickoff');
      return 'delivered';
    } catch (error) {
      // As the Start door does: restore the hold AND mark the fork failed. The
      // delivery set forkStatus 'injecting', which left alone hides the composer
      // and the held-handoff view behind a fork spinner that never ends.
      const message = error instanceof Error ? error.message : String(error);
      restoreHeldKickoff(conv.name, kickoff);
      updateForkStatus(conv.name, 'failed', message);
      console.error(`[conversations] undelivered kickoff for ${conv.name} still not delivered on resume:`, message);
      return 'failed';
    }
  }
  return deliverResumeContractUnlessGated(conv.tmuxSession, notice.text, notice.caller, notice.method, notice.send);
}
