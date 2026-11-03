/**
 * MobileConversations — the phone conversation list and view (PAN-2355 FR-5, D-14, D-15).
 *
 * The list reads `GET /api/conversations`, newest activity first, archived rows
 * hidden. A local id or name is read from `GET /api/conversations/:id`; a linked
 * name `@<machine>/<name>` is taken from the merged list (PAN-4871), because the
 * proxied single-row read returns the owner's own row. The view then mounts
 * `ConversationPanel` exactly as the standalone popout does. `ConversationPanel.tsx`
 * is never edited for the phone; layout fixes go in this wrapper's classes only.
 */
import { useQuery } from '@tanstack/react-query';
import { parseLinkedConversationName } from '@overdeck/contracts';
import { ConversationPanel } from '../chat/ConversationPanel';
import type { Conversation } from '../CommandDeck/ConversationList';
import { fetchWithTimeout } from '../../lib/apiFetch';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { conversationRouteKey, findLinkedConversationRow } from '../../lib/linkedConversation';

type ConversationRow = Conversation & { archivedAt?: string | null };

function recencyAt(c: ConversationRow): string {
  return c.lastActivityAt ?? c.lastAttachedAt ?? c.createdAt;
}

async function fetchConversationList(): Promise<ConversationRow[]> {
  const res = await fetchWithTimeout('/api/conversations');
  if (!res.ok) throw new Error(`Failed to load conversations: ${res.status}`);
  const rows = (await res.json()) as unknown;
  return Array.isArray(rows) ? (rows as ConversationRow[]) : [];
}

function ConversationListView({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['mobile-conversations'],
    queryFn: fetchConversationList,
  });
  if (isLoading) return <p className="px-4 py-6 text-sm text-muted-foreground">Loading conversations…</p>;
  if (isError) return <p className="px-4 py-6 text-sm text-muted-foreground">Couldn’t load conversations.</p>;
  const rows = (data ?? [])
    .filter((c) => c.archivedAt == null)
    .sort((a, b) => recencyAt(b).localeCompare(recencyAt(a)));
  if (rows.length === 0) return <p className="px-4 py-6 text-sm text-muted-foreground">No conversations.</p>;
  const now = new Date();
  return (
    <ul aria-label="Conversations" className="divide-y divide-border">
      {rows.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onOpen(conversationRouteKey(c))}
            className="flex min-h-11 w-full items-start justify-between gap-3 px-4 py-3 text-left"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{c.title?.trim() || c.name}</span>
              {c.issueId ? <span className="block text-xs text-muted-foreground">{c.issueId}</span> : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(recencyAt(c), now)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ConversationView({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const { data: conversation, isLoading, isError } = useQuery({
    queryKey: ['mobile-conversation', conversationId],
    queryFn: async () => {
      // PAN-4871: a linked key opens the merged list's viewer-shaped row, as the
      // desktop does. The proxied single-row read returns the owner's local row,
      // whose local name would subscribe on this machine and never load.
      if (parseLinkedConversationName(conversationId)) {
        const row = findLinkedConversationRow(await fetchConversationList(), conversationId);
        if (!row) throw new Error(`No linked conversation ${conversationId}`);
        return row as Conversation;
      }
      const res = await fetchWithTimeout(`/api/conversations/${encodeURIComponent(conversationId)}`);
      if (!res.ok) throw new Error(`Failed to load conversation: ${res.status}`);
      return (await res.json()) as Conversation;
    },
    // Same cadence as the standalone popout; EventRouter streams the rest.
    refetchInterval: 5000,
  });

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex min-h-11 items-center gap-2 border-b border-border px-2 pt-[env(safe-area-inset-top)]">
        <button type="button" onClick={onBack} className="min-h-11 min-w-11 px-2 text-sm font-medium text-foreground">
          Back
        </button>
        <h2 className="min-w-0 truncate text-sm font-medium text-foreground">
          {conversation ? conversation.title?.trim() || conversation.name : 'Conversation'}
        </h2>
      </header>
      {/* The desktop header row is one line; at phone width its actions would run
          off-screen, so let the row and its action group wrap (D-14: the panel
          itself is never edited). */}
      <div className="min-h-0 flex-1 overflow-hidden pb-[env(safe-area-inset-bottom)] [&_[class*=conversationHeaderPrimary]]:flex-wrap [&_[class*=conversationHeaderActions]]:flex-wrap">
        {isLoading && conversation === undefined ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading conversation…</p>
        ) : isError || conversation === undefined ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Couldn’t load this conversation. It may have been archived or deleted.
          </p>
        ) : (
          <ConversationPanel conversation={conversation} viewMode="conversation" onArchived={onBack} />
        )}
      </div>
    </div>
  );
}

export function MobileConversations({ conversationId, onOpen, onBack }: {
  conversationId: string | null;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  if (conversationId !== null) return <ConversationView conversationId={conversationId} onBack={onBack} />;
  return <ConversationListView onOpen={onOpen} />;
}
