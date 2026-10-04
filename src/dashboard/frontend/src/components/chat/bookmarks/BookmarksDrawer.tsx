/**
 * PAN-4498 WI-6: the Bookmarks header toggle and the bookmarks drawer list.
 * Both render nothing outside a ConversationBookmarksProvider.
 */
import { useState } from 'react';
import { Bookmark, Pencil, X } from 'lucide-react';
import styles from '../../CommandDeck/styles/command-deck.module.css';
import { formatTimestamp } from '../messagesTimeline/helpers';
import { useConversationBookmarks } from './ConversationBookmarks';

export function BookmarksToggle() {
  const ctx = useConversationBookmarks();
  if (!ctx) return null;
  const { listOpen, setListOpen, bookmarks } = ctx;
  return (
    <button
      type="button"
      className={`${styles.conversationAboutToggle} ${listOpen ? styles.conversationAboutToggleActive : ''}`}
      onClick={() => setListOpen(!listOpen)}
      title={listOpen ? 'Hide bookmarks' : 'Show bookmarks'}
      aria-label={listOpen ? 'Hide bookmarks' : 'Show bookmarks'}
      aria-pressed={listOpen}
    >
      <Bookmark size={14} />
      <span>{`Bookmarks${bookmarks.length > 0 ? ` ${bookmarks.length}` : ''}`}</span>
    </button>
  );
}

function BookmarkRow({ messageId, label, messageCreatedAt, createdAt }: {
  messageId: string;
  label: string;
  messageCreatedAt: string | null;
  createdAt: string;
}) {
  const ctx = useConversationBookmarks();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  if (!ctx) return null;

  return (
    <li className="flex items-center gap-2 text-xs">
      {editing ? (
        <input
          aria-label="Rename bookmark"
          maxLength={200}
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              const trimmed = value.trim();
              if (trimmed.length > 0 && trimmed !== label) void ctx.rename(messageId, trimmed);
              setEditing(false);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setValue(label);
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-foreground hover:underline"
          onClick={() => ctx.jumpTo(messageId)}
        >
          {label}
        </button>
      )}
      <span className="text-muted-foreground">{formatTimestamp(messageCreatedAt ?? createdAt)}</span>
      {!editing && (
        <button
          type="button"
          aria-label="Rename bookmark"
          className="shrink-0 border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
          onClick={() => { setValue(label); setEditing(true); }}
        >
          <Pencil size={12} />
        </button>
      )}
      <button
        type="button"
        aria-label="Remove bookmark"
        className="shrink-0 border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
        onClick={() => void ctx.remove(messageId)}
      >
        <X size={12} />
      </button>
    </li>
  );
}

export function BookmarksDrawer() {
  const ctx = useConversationBookmarks();
  if (!ctx || !ctx.listOpen) return null;

  return (
    <div className="max-h-60 overflow-y-auto border-b border-border px-3 py-1.5">
      {ctx.bookmarks.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No bookmarks yet. Click the icon beside a message to bookmark it.
        </p>
      ) : (
        <ul role="list" aria-label="Bookmarks" className="flex flex-col gap-1">
          {ctx.bookmarks.map((bookmark) => (
            <BookmarkRow
              key={bookmark.messageId}
              messageId={bookmark.messageId}
              label={bookmark.label}
              messageCreatedAt={bookmark.messageCreatedAt}
              createdAt={bookmark.createdAt}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
