import { getConversationById, getConversationByName } from '../../lib/overdeck/conversations.js';

/** Shared by handoff.ts and handoff-start.ts — a leaf module so neither imports the other. */
export function resolveConversation(convRef: string) {
  if (/^\d+$/.test(convRef)) {
    return getConversationById(parseInt(convRef, 10));
  }
  return getConversationByName(convRef);
}
