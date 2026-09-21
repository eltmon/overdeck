import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Star, Pencil, Sparkles, Share2, GitBranchPlus, Download, Copy, Check, Square, Archive, X, FileText, ExternalLink, Loader2, Columns2, Rows2, FolderInput } from 'lucide-react';
import { toast } from 'sonner';
import type { Conversation } from './ConversationList';
import type { ConversationMutations } from './useConversationMutations';
import { fetchRegisteredProjects } from './UnknownProjectState';
import { resolveEffectiveProjectKey } from './projectsData';
import { useConfirm } from '../DialogProvider';
import { MenuItemButton, MenuOverlay, MenuSeparator, MenuSurface } from '../shared/ContextMenu';
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
  /** Close every closable tab (HOME stays). */
  onCloseAll?: () => void;
  /** Open this tab in a side-by-side (right) split (PAN-1591). */
  onOpenInSplit?: () => void;
  /** Open this tab in a stacked (below) split. */
  onSplitDown?: () => void;
}

/**
 * The conversation "kebab" action menu, extracted so it can be reused wherever
 * conversation actions are needed — the list-row ⋮, and (PaneBar) right-click on
 * a workspace tab. Portaled to <body> and fixed-positioned at `position` so it
 * escapes any overflow clip. Inline rename happens inside the menu itself.
 */
export function ConversationActionMenu({ conversation, mutations, position, onClose, onCloseTab, onCloseOthers, onCloseRight, onCloseAll, onOpenInSplit, onSplitDown }: ConversationActionMenuProps) {
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(conversation.title ?? conversation.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [moveSubmenuOpen, setMoveSubmenuOpen] = useState(false);
  const { data: registeredProjects = [] } = useQuery({
    queryKey: ['registered-projects'],
    queryFn: fetchRegisteredProjects,
    staleTime: 60000,
  });

  // Dismiss on Escape / scroll / resize (portaled; position isn't tracked).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
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
      <MenuOverlay onClick={onClose} />
      <MenuSurface
        aria-label={`Actions for ${conversation.title ?? conversation.name}`}
        onClose={onClose}
        className="fixed z-[1000] min-w-[220px]"
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
            <MenuItemButton
              active={conversation.isFavorited}
              onClick={() => { mutations.toggleFavorite({ name: conversation.name, favorited: !!conversation.isFavorited }); onClose(); }}
            >
              <Star size={14} style={{ fill: conversation.isFavorited ? 'currentColor' : 'none' }} />
              {conversation.isFavorited ? 'Unfavorite' : 'Favorite'}
            </MenuItemButton>
            <MenuItemButton onClick={() => setRenaming(true)}>
              <Pencil size={14} />
              Rename
            </MenuItemButton>
            <MenuItemButton
              onClick={() => { mutations.retitle(conversation.name); onClose(); }}
              disabled={mutations.isRetitlePending(conversation.name)}
            >
              {mutations.isRetitlePending(conversation.name)
                ? <Loader2 size={14} className={styles.spinnerIcon} />
                : <Sparkles size={14} />}
              Regenerate title
            </MenuItemButton>
            {registeredProjects.length > 0 && (
              <span style={{ position: 'relative', display: 'block' }}>
                <MenuItemButton
                  aria-haspopup="menu"
                  aria-expanded={moveSubmenuOpen}
                  onClick={() => setMoveSubmenuOpen((open) => !open)}
                >
                  <FolderInput size={14} />
                  Move
                </MenuItemButton>
                {moveSubmenuOpen && (
                  <>
                    <MenuOverlay onClick={() => setMoveSubmenuOpen(false)} />
                    <MenuSurface
                      aria-label="Move conversation"
                      onClose={() => setMoveSubmenuOpen(false)}
                      className="absolute left-full top-0 z-[1001] ml-1 min-w-[180px]"
                    >
                      {registeredProjects.map((project) => {
                        const isCurrent = resolveEffectiveProjectKey(conversation, registeredProjects) === project.key;
                        const projectName = project.name ?? project.key;
                        return (
                          <MenuItemButton
                            key={project.key}
                            disabled={isCurrent}
                            onClick={() => {
                              if (isCurrent) return;
                              mutations.move({ name: conversation.name, projectKey: project.key, projectName });
                              setMoveSubmenuOpen(false);
                              onClose();
                            }}
                          >
                            {projectName}
                            {isCurrent && <Check size={14} className="ml-auto text-primary" />}
                          </MenuItemButton>
                        );
                      })}
                    </MenuSurface>
                  </>
                )}
              </span>
            )}

            {/* Tab conveniences (PAN-1591): pop out + multi-close. Only rendered
                when this menu was opened from a pane tab (onCloseTab present). */}
            {onCloseTab && (
              <>
                <MenuSeparator />
                {onOpenInSplit && (
                  <MenuItemButton onClick={() => { onOpenInSplit(); onClose(); }}>
                    <Columns2 size={14} />
                    Split right
                  </MenuItemButton>
                )}
                {onSplitDown && (
                  <MenuItemButton onClick={() => { onSplitDown(); onClose(); }}>
                    <Rows2 size={14} />
                    Split down
                  </MenuItemButton>
                )}
                <MenuItemButton
                  onClick={() => { window.open(`/popout/conversation/${conversation.id}`, '_blank', 'popup=yes,width=920,height=1040'); onClose(); }}
                >
                  <ExternalLink size={14} />
                  Pop out to window
                </MenuItemButton>
                {onCloseOthers && (
                  <MenuItemButton onClick={() => { onCloseOthers(); onClose(); }}>
                    <X size={14} />
                    Close other tabs
                  </MenuItemButton>
                )}
                {onCloseRight && (
                  <MenuItemButton onClick={() => { onCloseRight(); onClose(); }}>
                    <X size={14} />
                    Close tabs to the right
                  </MenuItemButton>
                )}
                {onCloseAll && (
                  <MenuItemButton onClick={() => { onCloseAll(); onClose(); }}>
                    <X size={14} />
                    Close all tabs
                  </MenuItemButton>
                )}
              </>
            )}

            <MenuSeparator />
            {conversation.claudeSessionId && (
              <MenuItemButton
                onClick={() => { mutations.openForkModal(conversation, { mode: 'handoff' }); onClose(); }}
              >
                <Share2 size={14} />
                Hand off to new conversation
              </MenuItemButton>
            )}
            {conversation.claudeSessionId && conversation.harness !== 'pi' && conversation.harness !== 'ohmypi' && (
              <MenuItemButton
                onClick={() => { mutations.openForkModal(conversation); onClose(); }}
              >
                <GitBranchPlus size={14} />
                Create summary fork
              </MenuItemButton>
            )}
            <MenuItemButton onClick={handleExport}>
              <Download size={14} />
              Export transcript
            </MenuItemButton>
            {conversation.handoffDocPath && (
              <MenuItemButton
                onClick={() => { window.open(`/api/conversations/${encodeURIComponent(conversation.name)}/handoff-doc`, '_blank', 'noopener,noreferrer'); onClose(); }}
              >
                <FileText size={14} />
                Open handoff doc
              </MenuItemButton>
            )}
            {conversation.handoffTargetConvId && (
              <MenuItemButton
                onClick={() => { window.location.href = `/conv/${conversation.handoffTargetConvId}`; onClose(); }}
              >
                <ExternalLink size={14} />
                Open handoff target
              </MenuItemButton>
            )}

            <MenuSeparator />
            <MenuItemButton onClick={handleCopyLink}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              Copy link
            </MenuItemButton>
            {conversation.sessionAlive && (
              <MenuItemButton
                onClick={() => { mutations.stop(conversation.name); onClose(); }}
              >
                <Square size={14} />
                Stop agent
              </MenuItemButton>
            )}

            <MenuSeparator />
            <MenuItemButton
              destructive
              onClick={handleArchive}
            >
              <Archive size={14} />
              Archive
            </MenuItemButton>
            {onCloseTab && (
              <MenuItemButton onClick={() => { onCloseTab(); onClose(); }}>
                <X size={14} />
                Close tab
              </MenuItemButton>
            )}
          </>
        )}
      </MenuSurface>
    </>,
    document.body,
  );
}
