import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Star, Pencil, Sparkles, Share2, GitBranchPlus, Download, Copy, Check, Square, Archive, X, FileText, ExternalLink, Loader2, Columns2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Conversation } from './ConversationList';
import type { ConversationMutations } from './useConversationMutations';
import { useConfirm } from '../DialogProvider';
import styles from './styles/command-deck.module.css';

interface ConversationActionMenuProps {
  conversation: Conversation;
  mutations: ConversationMutations;
  /** Viewport coordinates (fixed positioning) — typically the cursor. */
  position: { top: number; left: number };
  onClose: () => void;
  /** When provided, adds a "Close tab" item and closes the tab after archiving. */
  onCloseTab?: () => void;
  /** Tab conveniences (PAN-1591) — only present when invoked from a pane tab. */
  onCloseOthers?: () => void;
  onCloseRight?: () => void;
  /** Open this tab in a side-by-side split (PAN-1591). */
  onOpenInSplit?: () => void;
}

/**
 * The conversation "kebab" action menu, extracted so it can be reused wherever
 * conversation actions are needed — the list-row ⋮, and (PaneBar) right-click on
 * a workspace tab. Portaled to <body> and fixed-positioned at `position` so it
 * escapes any overflow clip. Inline rename happens inside the menu itself.
 */
export function ConversationActionMenu({ conversation, mutations, position, onClose, onCloseTab, onCloseOthers, onCloseRight, onOpenInSplit }: ConversationActionMenuProps) {
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(conversation.title ?? conversation.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  // Dismiss on Escape / scroll / resize (portaled; position isn't tracked).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const dismiss = () => onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [onClose]);

  useEffect(() => {
    if (renaming) setTimeout(() => inputRef.current?.select(), 0);
  }, [renaming]);

  const commitRename = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== (conversation.title ?? conversation.name)) {
      mutations.rename({ name: conversation.name, title: trimmed });
    }
    onClose();
  }, [draft, conversation.title, conversation.name, mutations, onClose]);

  const handleExport = useCallback(async () => {
    onClose();
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(conversation.name)}/messages`);
      if (!res.ok) throw new Error('fetch failed');
      const data = (await res.json()) as { messages?: Array<{ role: string; text?: string }> };
      const messages = data.messages ?? [];
      if (messages.length === 0) { toast.error('No messages to export yet'); return; }
      const md = `# ${conversation.title ?? conversation.name}\n\n` +
        messages.map((m) => `## ${m.role}\n\n${m.text ?? ''}\n`).join('\n');
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(conversation.title ?? conversation.name).replace(/[^\w.-]+/g, '-')}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Transcript exported');
    } catch {
      toast.error('Failed to export transcript');
    }
  }, [conversation.name, conversation.title, onClose]);

  const handleCopyLink = useCallback(() => {
    const link = `${window.location.origin}/conv/${conversation.id}`;
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      toast.success('Link copied');
      setTimeout(onClose, 400);
    });
  }, [conversation.id, onClose]);

  const handleArchive = useCallback(async () => {
    onClose();
    const ok = await confirm({
      title: conversation.isFavorited ? 'Archive favorited conversation' : 'Archive conversation',
      message: conversation.isFavorited
        ? `"${conversation.title ?? conversation.name}" is favorited.\n\nArchiving will remove the favorite, end the session, and move it to the archive.`
        : `Archive "${conversation.title ?? conversation.name}"? This ends the session and moves it to the archive.`,
      confirmLabel: 'Archive',
      cancelLabel: 'Cancel',
      variant: 'destructive',
    });
    if (ok) {
      mutations.archive(conversation.name);
      onCloseTab?.();
    }
  }, [confirm, conversation, mutations, onClose, onCloseTab]);

  return createPortal(
    <>
      <div className={styles.headerMenuOverlay} onClick={onClose} />
      <div
        role="menu"
        className={styles.headerMenu}
        style={{ position: 'fixed', top: position.top, left: position.left, right: 'auto' }}
      >
        {renaming ? (
          <input
            ref={inputRef}
            className={styles.conversationNameInput}
            style={{ flex: '0 0 auto', width: '100%' }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={commitRename}
            aria-label={`Rename ${conversation.name}`}
          />
        ) : (
          <>
            <button
              role="menuitem"
              className={`${styles.headerMenuItem} ${conversation.isFavorited ? styles.headerMenuItemActive : ''}`}
              onClick={() => { mutations.toggleFavorite({ name: conversation.name, favorited: !!conversation.isFavorited }); onClose(); }}
            >
              <Star size={14} style={{ fill: conversation.isFavorited ? 'currentColor' : 'none' }} />
              {conversation.isFavorited ? 'Unfavorite' : 'Favorite'}
            </button>
            <button role="menuitem" className={styles.headerMenuItem} onClick={() => setRenaming(true)}>
              <Pencil size={14} />
              Rename
            </button>
            <button
              role="menuitem"
              className={styles.headerMenuItem}
              onClick={() => { mutations.retitle(conversation.name); onClose(); }}
              disabled={mutations.isRetitlePending(conversation.name)}
            >
              {mutations.isRetitlePending(conversation.name)
                ? <Loader2 size={14} className={styles.spinnerIcon} />
                : <Sparkles size={14} />}
              Regenerate title
            </button>

            {/* Tab conveniences (PAN-1591): pop out + multi-close. Only rendered
                when this menu was opened from a pane tab (onCloseTab present). */}
            {onCloseTab && (
              <>
                <div className={styles.headerMenuDivider} />
                {onOpenInSplit && (
                  <button role="menuitem" className={styles.headerMenuItem} onClick={() => { onOpenInSplit(); onClose(); }}>
                    <Columns2 size={14} />
                    Open in split right
                  </button>
                )}
                <button
                  role="menuitem"
                  className={styles.headerMenuItem}
                  onClick={() => { window.open(`/conv/${conversation.id}`, '_blank', 'popup=yes,width=920,height=1040'); onClose(); }}
                >
                  <ExternalLink size={14} />
                  Pop out to window
                </button>
                {onCloseOthers && (
                  <button role="menuitem" className={styles.headerMenuItem} onClick={() => { onCloseOthers(); onClose(); }}>
                    <X size={14} />
                    Close other tabs
                  </button>
                )}
                {onCloseRight && (
                  <button role="menuitem" className={styles.headerMenuItem} onClick={() => { onCloseRight(); onClose(); }}>
                    <X size={14} />
                    Close tabs to the right
                  </button>
                )}
              </>
            )}

            <div className={styles.headerMenuDivider} />
            {conversation.claudeSessionId && (
              <button
                role="menuitem"
                className={styles.headerMenuItem}
                onClick={() => { mutations.openForkModal(conversation, { mode: 'handoff' }); onClose(); }}
              >
                <Share2 size={14} />
                Hand off to new conversation
              </button>
            )}
            {conversation.claudeSessionId && conversation.harness !== 'pi' && (
              <button
                role="menuitem"
                className={styles.headerMenuItem}
                onClick={() => { mutations.openForkModal(conversation); onClose(); }}
              >
                <GitBranchPlus size={14} />
                Create summary fork
              </button>
            )}
            <button role="menuitem" className={styles.headerMenuItem} onClick={handleExport}>
              <Download size={14} />
              Export transcript
            </button>
            {conversation.handoffDocPath && (
              <button
                role="menuitem"
                className={styles.headerMenuItem}
                onClick={() => { window.open(`/api/conversations/${encodeURIComponent(conversation.name)}/handoff-doc`, '_blank', 'noopener,noreferrer'); onClose(); }}
              >
                <FileText size={14} />
                Open handoff doc
              </button>
            )}
            {conversation.handoffTargetConvId && (
              <button
                role="menuitem"
                className={styles.headerMenuItem}
                onClick={() => { window.location.href = `/conv/${conversation.handoffTargetConvId}`; onClose(); }}
              >
                <ExternalLink size={14} />
                Open handoff target
              </button>
            )}

            <div className={styles.headerMenuDivider} />
            <button role="menuitem" className={styles.headerMenuItem} onClick={handleCopyLink}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              Copy link
            </button>
            {conversation.sessionAlive && (
              <button
                role="menuitem"
                className={styles.headerMenuItem}
                onClick={() => { mutations.stop(conversation.name); onClose(); }}
              >
                <Square size={14} />
                Stop agent
              </button>
            )}

            <div className={styles.headerMenuDivider} />
            <button
              role="menuitem"
              className={`${styles.headerMenuItem} ${styles.headerMenuItemDestructive}`}
              onClick={handleArchive}
            >
              <Archive size={14} />
              Archive
            </button>
            {onCloseTab && (
              <button role="menuitem" className={styles.headerMenuItem} onClick={() => { onCloseTab(); onClose(); }}>
                <X size={14} />
                Close tab
              </button>
            )}
          </>
        )}
      </div>
    </>,
    document.body,
  );
}
