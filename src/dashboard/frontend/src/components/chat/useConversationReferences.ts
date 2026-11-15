/**
 * useConversationReferences (PAN-5339 WI-3).
 *
 * Resolves `text`'s conversation-reference candidate keys (D10) to
 * `ConversationRef` entries: first against the settled `['conversations']`
 * list (D1), then with one `/api/conversations/<key>` lookup per key still
 * unmatched once that list has settled. A linked transcript's conversation
 * ids belong to the owner machine, so it resolves nothing and issues no
 * request at all.
 */
import { useMemo, useRef } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { parseLinkedConversationName } from '@overdeck/contracts';
import { fetchConversations, type Conversation } from '../CommandDeck/ConversationList';
import { fetchWithTimeout } from '../../lib/apiFetch';
import {
  collectConversationReferenceKeys,
  EMPTY_CONVERSATION_REFS,
  type ConversationRef,
  type ConversationRefMap,
} from '../../lib/conversationReferences';

const EMPTY_KEYS: string[] = [];
const EMPTY_CONVERSATIONS: Conversation[] = [];

function toRef(key: string, conversation: Conversation, currentConversationName: string | null): ConversationRef {
  return {
    key,
    routeKey: String(conversation.id),
    name: conversation.name,
    title: conversation.title ?? null,
    isCurrent: conversation.name === currentConversationName,
    conversation,
  };
}

async function fetchConversationReference(key: string): Promise<Conversation | null> {
  const res = await fetchWithTimeout(`/api/conversations/${encodeURIComponent(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch conversation ${key}`);
  return res.json();
}

export function useConversationReferences(text: string, currentConversationName: string | null): ConversationRefMap {
  const isLinkedTranscript = currentConversationName ? parseLinkedConversationName(currentConversationName) !== null : false;
  const keys = useMemo(
    () => (isLinkedTranscript ? EMPTY_KEYS : collectConversationReferenceKeys(text)),
    [text, isLinkedTranscript],
  );
  const select = useMemo(() => {
    const keySet = new Set(keys);
    return (list: Conversation[]) =>
      list.filter((row) => row.origin !== 'linked' && row.origin !== 'vault' && (keySet.has(String(row.id)) || keySet.has(row.name)));
  }, [keys]);

  const { data: matchedListed = EMPTY_CONVERSATIONS, isFetched: listSettled } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    enabled: keys.length > 0,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    select,
  });

  const listedByKey = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const row of matchedListed) {
      for (const key of keys) {
        if (key === String(row.id) || key === row.name) map.set(key, row);
      }
    }
    return map;
  }, [matchedListed, keys]);

  const unlistedKeys = useMemo(
    () => (listSettled ? keys.filter((key) => !listedByKey.has(key)) : EMPTY_KEYS),
    [keys, listedByKey, listSettled],
  );

  const unlistedResults = useQueries({
    queries: unlistedKeys.map((key) => ({
      queryKey: ['conversation-reference', key],
      queryFn: () => fetchConversationReference(key),
      staleTime: 300_000,
      refetchOnWindowFocus: false,
      retry: false,
    })),
  });

  const computed = useMemo(() => {
    const map = new Map<string, ConversationRef>();
    for (const [key, conversation] of listedByKey) map.set(key, toRef(key, conversation, currentConversationName));
    unlistedKeys.forEach((key, index) => {
      const conversation = unlistedResults[index]?.data;
      if (conversation) map.set(key, toRef(key, conversation, currentConversationName));
    });
    return map;
  }, [listedByKey, unlistedKeys, unlistedResults, currentConversationName]);

  const signature = Array.from(computed, ([key, ref]) => `${key}:${ref.routeKey}:${ref.title ?? ''}:${ref.isCurrent}`)
    .sort()
    .join('|');

  const stable = useRef<{ signature: string; map: ConversationRefMap }>({ signature: '', map: EMPTY_CONVERSATION_REFS });
  if (stable.current.signature !== signature) {
    stable.current = { signature, map: computed.size === 0 ? EMPTY_CONVERSATION_REFS : computed };
  }
  return stable.current.map;
}
