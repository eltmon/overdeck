import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Conversation } from './ConversationList';
import { fetchWithTimeout } from '../../lib/apiFetch';

const EMPTY_CONVERSATIONS: Conversation[] = [];

/** Deep links resolve independently of the enriched sidebar list, including archived rows. */
export function usePriorityConversation(id: string | null | undefined, list = EMPTY_CONVERSATIONS) {
  const listed = list.find((conversation) => String(conversation.id) === id || conversation.name === id);
  const query = useQuery({
    queryKey: ['conversation', id],
    enabled: !!id && !listed,
    queryFn: async ({ signal }): Promise<Conversation> => {
      const response = await fetchWithTimeout(`/api/conversations/${encodeURIComponent(id!)}`, { signal });
      if (!response.ok) throw new Error(response.status === 404
        ? 'Conversation not found.' : 'Could not load this conversation. Please try again.');
      return response.json();
    },
    retry: 5,
    retryDelay: 700,
  });
  const conversations = useMemo(() => listed || !query.data ? list : [...list, query.data], [list, listed, query.data]);
  return { conversations, error: listed ? null : query.error };
}
