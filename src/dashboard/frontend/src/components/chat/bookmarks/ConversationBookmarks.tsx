/**
 * PAN-4498 WI-3: the bookmarks context — fetches a conversation's bookmarks,
 * exposes add/rename/remove mutations, drawer open state, and the jump
 * channel (D8) that the main timeline uses to scroll to and flash a
 * bookmarked message. Mounted once per ConversationPanel, next to
 * ConversationPullRequestProvider.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchWithTimeout } from '../../../lib/apiFetch';

export interface ConversationBookmark {
  messageId: string;
  label: string;
  messageCreatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookmarkJumpRequest {
  messageId: string;
  nonce: number;
}

export interface ConversationBookmarksValue {
  conversationName: string;
  bookmarks: ConversationBookmark[];
  byMessageId: ReadonlyMap<string, ConversationBookmark>;
  add(messageId: string, label: string, messageCreatedAt: string | null): Promise<void>;
  rename(messageId: string, label: string): Promise<void>;
  remove(messageId: string): Promise<void>;
  listOpen: boolean;
  setListOpen(open: boolean): void;
  jumpRequest: BookmarkJumpRequest | null;
  jumpTo(messageId: string): void;
  /** FR-13: the last jump target that was not found in the loaded timeline. */
  missingMessageId: string | null;
  resolveJump(nonce: number, found: boolean): void;
}

/** D3: the default label offered when a message is first bookmarked. */
export function defaultBookmarkLabel(text: string): string {
  const firstNonEmptyLine = text.split('\n').find((line) => line.trim().length > 0) ?? '';
  const withoutPrefix = firstNonEmptyLine.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/, '');
  const cleaned = withoutPrefix.replace(/`/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return 'Bookmarked message';
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned;
}

const ConversationBookmarksContext = createContext<ConversationBookmarksValue | null>(null);

async function fetchBookmarks(conversationName: string): Promise<ConversationBookmark[]> {
  try {
    const res = await fetchWithTimeout(`/api/conversations/${encodeURIComponent(conversationName)}/bookmarks`);
    if (!res.ok) return [];
    const data = (await res.json()) as { bookmarks?: ConversationBookmark[] };
    return data.bookmarks ?? [];
  } catch {
    return [];
  }
}

export function ConversationBookmarksProvider({ conversationName, children }: {
  conversationName: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['conversation-bookmarks', conversationName], [conversationName]);
  const bookmarksQuery = useQuery({
    queryKey,
    queryFn: () => fetchBookmarks(conversationName),
  });
  const bookmarks = bookmarksQuery.data ?? [];
  const byMessageId = useMemo(
    () => new Map(bookmarks.map((bookmark) => [bookmark.messageId, bookmark])),
    [bookmarks],
  );

  const [listOpen, setListOpen] = useState(false);
  const [jumpRequest, setJumpRequest] = useState<BookmarkJumpRequest | null>(null);
  const [missingMessageId, setMissingMessageId] = useState<string | null>(null);
  const jumpNonceRef = useRef(0);
  const latestJumpRef = useRef<BookmarkJumpRequest | null>(null);

  const putBookmark = useCallback(async (messageId: string, label: string, messageCreatedAt?: string | null) => {
    try {
      const res = await fetchWithTimeout(
        `/api/conversations/${encodeURIComponent(conversationName)}/bookmarks/${encodeURIComponent(messageId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label, messageCreatedAt }),
        },
      );
      const data = await res.json().catch(() => null) as { bookmark?: ConversationBookmark; error?: string } | null;
      if (!res.ok || !data?.bookmark) throw new Error(data?.error || 'Failed to save bookmark');
      const current = queryClient.getQueryData<ConversationBookmark[]>(queryKey) ?? [];
      const next = [...current.filter((bookmark) => bookmark.messageId !== messageId), data.bookmark];
      queryClient.setQueryData(queryKey, next);
      void queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { duration: 6000 });
    }
  }, [conversationName, queryClient, queryKey]);

  const add = useCallback(
    (messageId: string, label: string, messageCreatedAt: string | null) => putBookmark(messageId, label, messageCreatedAt),
    [putBookmark],
  );
  const rename = useCallback(
    (messageId: string, label: string) => putBookmark(messageId, label),
    [putBookmark],
  );

  const remove = useCallback(async (messageId: string) => {
    try {
      const res = await fetchWithTimeout(
        `/api/conversations/${encodeURIComponent(conversationName)}/bookmarks/${encodeURIComponent(messageId)}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error || 'Failed to remove bookmark');
      const current = queryClient.getQueryData<ConversationBookmark[]>(queryKey) ?? [];
      queryClient.setQueryData(queryKey, current.filter((bookmark) => bookmark.messageId !== messageId));
      void queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { duration: 6000 });
    }
  }, [conversationName, queryClient, queryKey]);

  const jumpTo = useCallback((messageId: string) => {
    const next = { messageId, nonce: jumpNonceRef.current + 1 };
    jumpNonceRef.current = next.nonce;
    latestJumpRef.current = next;
    setMissingMessageId(null);
    setJumpRequest(next);
  }, []);

  const resolveJump = useCallback((nonce: number, found: boolean) => {
    if (latestJumpRef.current?.nonce !== nonce) return;
    if (!found) setMissingMessageId(latestJumpRef.current.messageId);
  }, []);

  const value = useMemo<ConversationBookmarksValue>(() => ({
    conversationName,
    bookmarks,
    byMessageId,
    add,
    rename,
    remove,
    listOpen,
    setListOpen,
    jumpRequest,
    jumpTo,
    missingMessageId,
    resolveJump,
  }), [conversationName, bookmarks, byMessageId, add, rename, remove, listOpen, jumpRequest, jumpTo, missingMessageId, resolveJump]);

  return (
    <ConversationBookmarksContext.Provider value={value}>
      {children}
    </ConversationBookmarksContext.Provider>
  );
}

export function useConversationBookmarks(): ConversationBookmarksValue | null {
  return useContext(ConversationBookmarksContext);
}
