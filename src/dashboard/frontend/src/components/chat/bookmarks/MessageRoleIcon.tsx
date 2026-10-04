/**
 * PAN-4498 WI-4/WI-5: the message role icon doubles as the bookmark control,
 * and a bookmarked icon opens a rename/remove popover. Outside a
 * bookmarks-enabled main timeline (no provider, or bookmarkable is false — a
 * subagent transcript, an optimistic/held/streaming row) it renders the plain
 * role glyph exactly as before.
 */
import { useEffect, useRef, useState } from 'react';
import { Bot, Bookmark, User } from 'lucide-react';
import type { ChatMessage } from '../chat-types';
import { defaultBookmarkLabel, useConversationBookmarks, type ConversationBookmark } from './ConversationBookmarks';

function BookmarkEditPopover({ bookmark, onSave, onRemove, onClose }: {
  bookmark: ConversationBookmark;
  onSave: (label: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(bookmark.label);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed !== bookmark.label) onSave(trimmed);
    onClose();
  };

  return (
    <div className="absolute left-0 top-full z-30 w-64 rounded-lg border border-border bg-popover p-2 shadow-lg">
      <input
        aria-label="Bookmark label"
        maxLength={200}
        value={value}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
        className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onRemove} className="rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10">
          Remove
        </button>
        <button type="button" onClick={commit} className="rounded px-2 py-1 text-xs text-primary hover:bg-primary/10">
          Save
        </button>
      </div>
    </div>
  );
}

export function MessageRoleIcon({ message, role, bookmarkable, className }: {
  message: ChatMessage;
  role: 'assistant' | 'user';
  bookmarkable?: boolean;
  className?: string;
}) {
  const ctx = useConversationBookmarks();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const bookmark = bookmarkable && ctx ? ctx.byMessageId.get(message.id) : undefined;

  useEffect(() => {
    if (!popoverOpen) return;
    function onMouseDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [popoverOpen]);

  const RoleGlyph = role === 'assistant' ? Bot : User;

  if (!bookmarkable || !ctx) {
    return <RoleGlyph size={14} className={className} aria-hidden="true" />;
  }

  return (
    <span ref={wrapperRef} className={`relative inline-flex ${className ?? ''}`}>
      <button
        type="button"
        className="inline-flex shrink-0 rounded border-0 bg-transparent p-0 opacity-70 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        aria-pressed={!!bookmark}
        aria-label={bookmark ? `Bookmarked: ${bookmark.label}` : 'Bookmark this message'}
        title={bookmark ? `Bookmarked: ${bookmark.label}` : 'Bookmark this message'}
        onClick={() => {
          if (bookmark) {
            setPopoverOpen((open) => !open);
            return;
          }
          void ctx.add(message.id, defaultBookmarkLabel(message.text), message.createdAt);
        }}
      >
        {bookmark
          ? <Bookmark size={14} fill="currentColor" className="text-primary opacity-100" />
          : <RoleGlyph size={14} />}
      </button>
      {popoverOpen && bookmark && (
        <BookmarkEditPopover
          bookmark={bookmark}
          onSave={(label) => { void ctx.rename(message.id, label); }}
          onRemove={() => { void ctx.remove(message.id); setPopoverOpen(false); }}
          onClose={() => setPopoverOpen(false)}
        />
      )}
    </span>
  );
}
