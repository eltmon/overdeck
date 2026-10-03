/** PAN-4499 WI-5: claim and deliver a held handoff's kickoff exactly once. */
import {
  deliverForkSeed,
  ensureForkSessionReady,
  registerInFlightForkPipeline,
} from './conversation-forks.js';
import { claimHeldKickoff, restoreHeldKickoff } from './conversation-kickoff-store.js';
import { getConversationByName, updateForkStatus, type LegacyConversation as Conversation } from './conversations.js';

export type StartKickoffResult =
  | { status: 'started'; conversation: Conversation }
  | { status: 'not-found' }
  | { status: 'not-held' }
  | { status: 'invalid'; error: string };

const MAX_KICKOFF_TEXT_LENGTH = 100000;

async function deliverClaimedKickoff(conv: Conversation, seed: string, claimed: string): Promise<void> {
  try {
    if (!conv.claudeSessionId) throw new Error(`Conversation ${conv.name} has no session id`);
    await ensureForkSessionReady(conv, conv.claudeSessionId, false);
  } catch (error) {
    restoreHeldKickoff(conv.name, claimed);
    updateForkStatus(conv.name, 'failed', error instanceof Error ? error.message : String(error));
    return;
  }
  try {
    await deliverForkSeed(conv, seed, 'handoff-kickoff');
  } catch (error) {
    restoreHeldKickoff(conv.name, claimed);
    updateForkStatus(conv.name, 'failed', error instanceof Error ? error.message : String(error));
  }
}

/** Claims the held kickoff and starts delivery in the background; never `markConversationEnded` (D9). */
export async function startHeldKickoff(name: string, text?: unknown): Promise<StartKickoffResult> {
  const conv = getConversationByName(name);
  if (!conv) return { status: 'not-found' };
  let editedText: string | undefined;
  if (text !== undefined) {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (typeof text !== 'string' || trimmed.length < 1 || trimmed.length > MAX_KICKOFF_TEXT_LENGTH) {
      return { status: 'invalid', error: 'text must be a non-empty string of at most 100000 characters' };
    }
    editedText = trimmed;
  }
  const claimed = claimHeldKickoff(name);
  if (claimed === null) return { status: 'not-held' };
  // D8: surface progress exactly like a fork — a held row's forkStatus is null
  // until delivery starts, so a poll landing before ensureForkSessionReady's
  // first updateForkStatus('injecting') would otherwise see null and report
  // "delivered" before anything was sent.
  updateForkStatus(name, 'spawning');
  registerInFlightForkPipeline(deliverClaimedKickoff(conv, editedText ?? claimed, claimed));
  return { status: 'started', conversation: getConversationByName(name) ?? conv };
}
