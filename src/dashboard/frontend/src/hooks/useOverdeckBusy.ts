/**
 * Whether Overdeck is doing something right now: an agent is running or
 * starting, or a conversation is mid-turn. Drives the orbiting sidebar logo.
 *
 * Agents come from the read-model store. Conversation turn state is not in the
 * store, so this shares the `['conversations']` query (and its 10s refresh)
 * that the Command Deck and status bar already use — the same `isWorking` flag
 * that drives the conversation-list spinners.
 */
import { useQuery } from '@tanstack/react-query';

import { fetchConversations } from '../components/CommandDeck/ConversationList';
import { selectAgents, useDashboardStore } from '../lib/store';

export function isOverdeckBusy(
  agents: ReadonlyArray<{ status: string }>,
  conversations: ReadonlyArray<{ isWorking?: boolean }>,
): boolean {
  return (
    agents.some((agent) => agent.status === 'running' || agent.status === 'starting') ||
    conversations.some((conversation) => conversation.isWorking === true)
  );
}

export function useOverdeckBusy(): boolean {
  const agents = useDashboardStore(selectAgents);
  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });
  return isOverdeckBusy(agents, Array.isArray(conversations) ? conversations : []);
}
