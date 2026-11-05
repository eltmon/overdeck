/**
 * The Claude session id a conversation's transcript reads use (PAN-2652).
 * Human chain heads: the current locator, then the launcher pin. Superseded
 * /clear rows: their own locator only — the shared launcher belongs to the head.
 * Agent conversations: the launcher pin first, unchanged (PAN-1866).
 */
import { readLauncherPinnedSessionId } from '../agents/transcript-resolver.js';
import { isSupersededConversation } from './conversation-clear-chain.js';
import { isAgentConversationName, type LegacyConversation } from './conversations.js';

type SessionConv = Pick<LegacyConversation, 'name' | 'tmuxSession' | 'claudeSessionId' | 'clearedToConvId'>;

export async function resolveConversationClaudeSessionId(
  conv: SessionConv,
  readPin: (tmuxSession: string) => Promise<string | null> = readLauncherPinnedSessionId,
): Promise<string | null> {
  if (isSupersededConversation(conv)) return conv.claudeSessionId;
  const pin = conv.tmuxSession ? await readPin(conv.tmuxSession) : null;
  if (isAgentConversationName(conv.name)) return pin ?? conv.claudeSessionId;
  return conv.claudeSessionId ?? pin;
}
