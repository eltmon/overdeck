import type { Conversation } from '../components/CommandDeck/ConversationList';

/** Composer notice: Claude Code's agent selector shows a subagent receiving typed input (PAN-4268). */
export type SubagentRoutingNotice = { description: string } | null;

export function inputTargetNotice(inputTarget: Conversation['inputTarget']): SubagentRoutingNotice {
  if (inputTarget && typeof inputTarget === 'object') return { description: inputTarget.subagent };
  return null;
}
