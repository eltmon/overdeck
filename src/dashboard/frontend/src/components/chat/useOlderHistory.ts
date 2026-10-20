import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { CONVERSATION_PAGE_DEFAULT_LIMIT } from '@overdeck/contracts';
import { fetchWithTimeout } from '../../lib/apiFetch';
import type { ChatMessage, ConversationWindow, WorkLogEntry } from './chat-types';
import { prependOlderPage, type HistoryRows } from './conversationHistory';

/** Upper bound on pages one jump may load before it gives up. */
const LOAD_OLDER_UNTIL_MAX_PAGES = 100;

interface OlderPage {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  window: ConversationWindow;
}

export interface OlderHistory {
  hasOlder: boolean;
  loadingOlder: boolean;
  /** At least one older page was prepended since this conversation opened. */
  loadedOlder: boolean;
  error: string | null;
  loadOlder: () => Promise<void>;
  /** Loads older pages until `messageId` is in the cache or the start is reached. */
  loadOlderUntil: (messageId: string) => Promise<boolean>;
}

/**
 * PAN-4558 FR-10: pages older conversation history into the message cache.
 * `pagePath` is the read that accepts `before=<cursor>&limit=<n>`; `history`
 * is the cache's current window. One request is in flight at a time.
 */
export function useOlderHistory({ queryKey, pagePath, history }: {
  queryKey: QueryKey;
  pagePath: string | null;
  history: ConversationWindow | undefined;
}): OlderHistory {
  const queryClient = useQueryClient();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadedOlder, setLoadedOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const queryKeyHash = JSON.stringify(queryKey);

  useEffect(() => {
    setLoadedOlder(false);
    setError(null);
  }, [queryKeyHash]);

  const loadOlder = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const cursor = queryClient.getQueryData<HistoryRows>(queryKey)?.history;
    if (!pagePath || !cursor?.hasOlder || cursor.cursor === null) return Promise.resolve();
    const requestedCursor = cursor.cursor;
    const separator = pagePath.includes('?') ? '&' : '?';
    const url = `${pagePath}${separator}before=${encodeURIComponent(requestedCursor)}&limit=${CONVERSATION_PAGE_DEFAULT_LIMIT}`;
    const request = (async () => {
      setLoadingOlder(true);
      try {
        const response = await fetchWithTimeout(url);
        if (!response.ok) throw new Error(`Failed to load earlier messages (${response.status})`);
        const page = await response.json() as OlderPage;
        queryClient.setQueryData<HistoryRows>(queryKey, (previous) =>
          previous ? prependOlderPage(previous, page, requestedCursor) : previous);
        setLoadedOlder(true);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlightRef.current = null;
        setLoadingOlder(false);
      }
    })();
    inFlightRef.current = request;
    return request;
  }, [pagePath, queryClient, queryKey]);

  const loadOlderUntil = useCallback(async (messageId: string): Promise<boolean> => {
    for (let page = 0; page < LOAD_OLDER_UNTIL_MAX_PAGES; page++) {
      const cache = queryClient.getQueryData<HistoryRows>(queryKey);
      if (cache?.messages.some((message) => message.id === messageId)) return true;
      const before = cache?.history;
      if (!before?.hasOlder) return false;
      await loadOlder();
      // No progress (a failed or stale read) ends the walk.
      if (queryClient.getQueryData<HistoryRows>(queryKey)?.history?.cursor === before.cursor) return false;
    }
    return false;
  }, [loadOlder, queryClient, queryKey]);

  return { hasOlder: history?.hasOlder ?? false, loadingOlder, loadedOlder, error, loadOlder, loadOlderUntil };
}
