/**
 * PAN-4498 WI-4: the message role icon doubles as the bookmark control.
 * Outside a bookmarks-enabled main timeline (no provider, or bookmarkable is
 * false — a subagent transcript, an optimistic/held/streaming row) it renders
 * the plain role glyph exactly as before.
 */
import { Bot, Bookmark, User } from 'lucide-react';
import type { ChatMessage } from '../chat-types';
import { defaultBookmarkLabel, useConversationBookmarks } from './ConversationBookmarks';

export function MessageRoleIcon({ message, role, bookmarkable, className }: {
  message: ChatMessage;
  role: 'assistant' | 'user';
  bookmarkable?: boolean;
  className?: string;
}) {
  const ctx = useConversationBookmarks();
  const RoleGlyph = role === 'assistant' ? Bot : User;

  if (!bookmarkable || !ctx) {
    return <RoleGlyph size={14} className={className} aria-hidden="true" />;
  }

  const bookmark = ctx.byMessageId.get(message.id);

  return (
    <button
      type="button"
      className={`inline-flex shrink-0 rounded border-0 bg-transparent p-0 opacity-70 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${className ?? ''}`}
      aria-pressed={!!bookmark}
      aria-label={bookmark ? `Bookmarked: ${bookmark.label}` : 'Bookmark this message'}
      title={bookmark ? `Bookmarked: ${bookmark.label}` : 'Bookmark this message'}
      onClick={() => {
        if (bookmark) return; // WI-5: opens the rename/remove popover
        void ctx.add(message.id, defaultBookmarkLabel(message.text), message.createdAt);
      }}
    >
      {bookmark
        ? <Bookmark size={14} fill="currentColor" className="text-primary opacity-100" />
        : <RoleGlyph size={14} />}
    </button>
  );
}
