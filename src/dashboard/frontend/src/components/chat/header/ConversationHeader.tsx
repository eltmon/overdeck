import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, FileX, Info, Loader2, MoreVertical, Pencil, Square, Wrench, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Conversation } from '../../CommandDeck/ConversationList';
import { updateConversationTitle } from '../../CommandDeck/ConversationList';
import type { useConversationMutations } from '../../CommandDeck/useConversationMutations';
import { ViewToggle } from '../../shared/ViewToggle';
import { isNativeShell } from '../../../lib/nativeShell';
import { conversationMachineState, isLiveMachineState, RemoteHeaderActions } from '../ConversationMachineBanner';
import { BookmarksToggle } from '../bookmarks/BookmarksDrawer';
import type { ViewMode } from '../useNeedsTerminalAutoSwitch';
import { ConversationHeaderMenu } from './ConversationHeaderMenu';
import { ConversationStatusLine } from './ConversationStatusLine';
import { HeaderDockButtons, StageHeaderChanges, type HeaderChanges } from './headerChanges';
import { useStageDeck } from '../../Stage/StageDeckContext';
import styles from '../../CommandDeck/styles/command-deck.module.css';

export interface ConversationHeaderProps {
  conversation: Conversation;
  agentId?: string;
  viewMode: ViewMode;
  effectiveViewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
  showTerminal: boolean;
  isWorking: boolean;
  working: { label: string; Icon: LucideIcon; iconClass: string };
  status: { color: string; label: string; hollow: boolean };
  machineState: ReturnType<typeof conversationMachineState>;
  aboutOpen: boolean;
  onToggleAbout: () => void;
  hideToolCalls: boolean;
  onToggleHideToolCalls: () => void;
  convMutations: ReturnType<typeof useConversationMutations>;
  archivePending: boolean;
  /** Present when the panel may archive (today's `onArchived`); runs `handleArchive`. */
  onArchive?: () => void;
}

/**
 * The conversation header (hidden in embedded mode). Three-tier layout:
 * row 1 = title + primary actions, row 2 = read-only metadata, long-tail /
 * config / destructive actions live in the ⋮ menu.
 */
export function ConversationHeader({
  conversation,
  agentId,
  viewMode,
  effectiveViewMode,
  onViewMode,
  showTerminal,
  isWorking,
  working,
  status,
  machineState,
  aboutOpen,
  onToggleAbout,
  hideToolCalls,
  onToggleHideToolCalls,
  convMutations,
  archivePending,
  onArchive,
}: ConversationHeaderProps) {
  const queryClient = useQueryClient();
  const native = isNativeShell(); // The phone app (PAN-4837): hide what its phone token cannot do.
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const draftTitleRef = useRef('');
  const committingRef = useRef(false);

  const abortMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/conversations/${encodeURIComponent(conversation.name)}/abort`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to stop turn (${res.status})${body ? `: ${body}` : ''}`);
      }
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 6000 });
    },
  });

  const renameMutation = useMutation({
    mutationFn: (title: string) => updateConversationTitle(conversation.name, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  // Regenerate the title from the whole conversation (not just the first message).
  const retitleMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(conversation.name)}/retitle`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to regenerate title');
      return data as { title: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success(`Renamed to "${data.title}"`, { duration: 4000 });
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 6000 });
    },
  });

  const startEditingTitle = useCallback(() => {
    committingRef.current = false;
    const initial = conversation.title ?? conversation.name;
    draftTitleRef.current = initial;
    setDraftTitle(initial);
    setEditingTitle(true);
    setTimeout(() => {
      titleInputRef.current?.select();
    }, 0);
  }, [conversation.title, conversation.name]);

  const commitTitleRename = useCallback(() => {
    if (committingRef.current) return;
    committingRef.current = true;
    const trimmed = draftTitleRef.current.trim();
    const original = conversation.title ?? conversation.name;
    setEditingTitle(false);
    if (trimmed && trimmed !== original) {
      renameMutation.mutate(trimmed);
    }
  }, [conversation.title, conversation.name, renameMutation]);

  const cancelTitleEditing = useCallback(() => {
    setEditingTitle(false);
    setDraftTitle('');
  }, []);

  const handleCopyLink = useCallback(() => {
    const params = new URLSearchParams();
    if (viewMode === 'terminal') {
      params.set('view', 'terminal');
    }
    const query = params.toString();
    const url = `${window.location.origin}/conv/${conversation.id}${query ? `?${query}` : ''}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [conversation.id, viewMode]);

  // Open the conversation in a new browser window — the "detach" affordance
  // matching the ⋮ → "Pop out to window" menu item, lifted into the header so
  // it's discoverable next to Copy link. Mirrors Stage's drag-off-to-detach so
  // both entry points land on the same /popout/conversation/<id> route — a bare
  // conversation view with no dashboard chrome (sidebar, awareness rail, etc.).
  const handleDetach = useCallback(() => {
    const params = new URLSearchParams();
    if (viewMode === 'terminal') params.set('view', 'terminal');
    const query = params.toString();
    const url = `/popout/conversation/${conversation.id}${query ? `?${query}` : ''}`;
    window.open(url, '_blank', 'popup=yes,width=920,height=1040');
  }, [conversation.id, viewMode]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const showPiAbort = isWorking && (conversation.harness === 'ohmypi' || conversation.harness === 'pi');
  const WorkingIcon = working.Icon;

  const deck = useStageDeck();
  const renderRows = (changes: HeaderChanges | null) => (
    <>
      {/* Row 1 — title + primary actions */}
      <div className={styles.conversationHeaderPrimary}>
        <span className={styles.conversationTerminalTitle}>
          {isWorking && (
            <span title={working.label} style={{ display: 'contents' }}>
              <WorkingIcon
                size={14}
                className={working.iconClass}
                aria-label={working.label}
              />
            </span>
          )}
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className={styles.conversationTitleInput}
              value={draftTitle}
              onChange={e => { setDraftTitle(e.target.value); draftTitleRef.current = e.target.value; }}
              onKeyDown={e => {
                if (e.key === 'Enter') commitTitleRename();
                if (e.key === 'Escape') cancelTitleEditing();
              }}
              onBlur={commitTitleRename}
              aria-label={`Rename ${conversation.name}`}
            />
          ) : (
            <>
              <span className={`${styles.conversationTerminalTitleText} ${retitleMutation.isPending ? styles.titleRegenerating : ''}`}>
                {conversation.title ?? conversation.name}
              </span>
              {conversation.transcriptMissing && (
                <span
                  title="Transcript missing — this conversation had activity, but its history file no longer exists on disk. The history cannot be recovered."
                  aria-label="Transcript missing"
                  style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--warning)', flexShrink: 0 }}
                >
                  <FileX size={13} />
                </span>
              )}
              <button
                className={styles.conversationTitleEditBtn} hidden={native || !isLiveMachineState(machineState)}
                onClick={startEditingTitle}
                title="Rename conversation"
                aria-label={`Rename ${conversation.name}`}
              >
                <Pencil size={12} />
              </button>
            </>
          )}
        </span>

        <div className={styles.conversationHeaderActions}>
          {/* View toggle — only when session is live */}
          {showTerminal && isLiveMachineState(machineState) && (
            <ViewToggle
              ariaLabel="Conversation view"
              value={effectiveViewMode}
              onChange={onViewMode}
              options={[
                { id: 'conversation', label: 'Conversation' },
                { id: 'terminal', label: 'Terminal' },
              ]}
            />
          )}

          <RemoteHeaderActions conversation={conversation} />
          <button
            className={`${styles.conversationAboutToggle} ${aboutOpen ? styles.conversationAboutToggleActive : ''}`}
            onClick={onToggleAbout}
            title={aboutOpen ? 'Hide conversation summary' : 'Show conversation summary'}
            aria-label={aboutOpen ? 'Hide about this conversation' : 'Show about this conversation'}
            aria-pressed={aboutOpen}
          >
            <Info size={14} />
            <span>About</span>
          </button>

          <button
            className={`${styles.conversationAboutToggle} ${hideToolCalls ? styles.conversationAboutToggleActive : ''}`}
            onClick={onToggleHideToolCalls}
            title={hideToolCalls ? 'Show tool calls' : 'Hide tool calls'}
            aria-label={hideToolCalls ? 'Show tool calls' : 'Hide tool calls'}
            aria-pressed={hideToolCalls}
          >
            <Wrench size={14} />
            <span>Tools</span>
          </button>

          <BookmarksToggle />

          {showPiAbort && (
            <button
              className={`${styles.conversationAboutToggle} ${abortMutation.isPending ? styles.conversationAboutToggleActive : ''}`}
              onClick={() => abortMutation.mutate()}
              disabled={abortMutation.isPending}
              title="Stop current turn"
              aria-label="Stop current turn"
            >
              {abortMutation.isPending ? <Loader2 size={14} className={styles.spinnerIcon} /> : <Square size={14} />}
              <span>{abortMutation.isPending ? 'Stopping…' : 'Stop'}</span>
            </button>
          )}

          {(archivePending || convMutations.isStopPending(conversation.name)) && (
            <span className={styles.conversationAboutToggle} role="status" aria-live="polite" aria-label={archivePending ? 'Archiving conversation' : 'Stopping conversation'}>
              <Loader2 size={14} className={styles.spinnerIcon} /><span>{archivePending ? 'Archiving…' : 'Stopping…'}</span>
            </span>
          )}
          {/* Copy link */}
          <button
            className={styles.copyLinkButton}
            onClick={handleCopyLink}
            title="Copy link to conversation"
            aria-label="Copy link to conversation"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>

          {/* Detach — open the conversation in a new browser window. Same
              target as the ⋮ → "Pop out to window" item, exposed here so
              the action is discoverable next to Copy link. */}
          <button
            className={styles.copyLinkButton}
            onClick={handleDetach}
            title="Detach conversation"
            aria-label="Detach conversation"
          >
            <ExternalLink size={14} />
          </button>

          {changes && <HeaderDockButtons changes={changes} />}

          {/* Overflow menu — long-tail / prefs / config / destructive */}
          <div className={styles.headerMenuWrap}>
            <button
              ref={menuTriggerRef}
              className={styles.copyLinkButton}
              onClick={() => setMenuOpen(v => !v)}
              title="More actions"
              aria-label="More conversation actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <MoreVertical size={16} />
            </button>
            <ConversationHeaderMenu
              open={menuOpen}
              conversation={conversation}
              agentId={agentId}
              viewMode={viewMode}
              convMutations={convMutations}
              archivePending={archivePending}
              onArchive={onArchive}
              onClose={closeMenu}
              triggerRef={menuTriggerRef}
              native={native}
              retitlePending={retitleMutation.isPending}
              onRetitle={() => retitleMutation.mutate()}
            />
          </div>
        </div>
      </div>

      {/* Row 2 — read-only metadata */}
      <ConversationStatusLine conversation={conversation} status={status} native={native} changes={changes} />
    </>
  );

  return (
    <div
      className={`${styles.conversationHeaderShell} ${styles.conversationHeaderContainer}`} data-machine-state={machineState}
      onContextMenu={(e) => {
        // Right-click the header → open the ⋮ menu. Skip while renaming so
        // the native copy/paste menu still works in the title input.
        if (editingTitle) return;
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      {deck?.openDock
        ? <StageHeaderChanges conversation={conversation} openDock={deck.openDock}>{renderRows}</StageHeaderChanges>
        : renderRows(null)}
    </div>
  );
}
