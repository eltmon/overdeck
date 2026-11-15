import { useCallback, useEffect, useState, type RefObject } from 'react';
import { Archive, Copy, Download, ExternalLink, FileText, GitBranchPlus, Hash, Info, Loader2, MonitorSmartphone, Share2, Sparkles, Square, Star, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import type { Conversation } from '../../CommandDeck/ConversationList';
import type { useConversationMutations } from '../../CommandDeck/useConversationMutations';
import { PullRequestMenuItems } from '../../CommandDeck/PullRequestMenuItems';
import { useConfirm } from '../../DialogProvider';
import { MenuItemButton, MenuOverlay, MenuSeparator, MenuSurface } from '../../shared/ContextMenu';
import { PullHereButton, runsHere } from '../ConversationMachineBanner';
import { ShareConversationMenuItem } from '../sharing/ShareDialog';
import { BookmarksMenuItem } from '../bookmarks/BookmarksDrawer';
import { OpenFolderMenuItems } from './OpenFolderMenuItems';
import { continueTargetOf, openContinueOnDevice } from '../continueOnDevice/continueOnDeviceStore';
import { fetchFullTranscript, type MessagesResponse } from '../messagesQuery';
import type { ViewMode } from '../useNeedsTerminalAutoSwitch';
import styles from '../../CommandDeck/styles/command-deck.module.css';

type DeliveryMethod = 'auto' | 'channels' | 'tmux';

async function updateConversationDeliveryMethod(
  name: string,
  deliveryMethod: DeliveryMethod,
): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/delivery-method`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deliveryMethod }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to update delivery method (${res.status})${body ? `: ${body}` : ''}`);
  }
}

function copyText(text: string, done: string): void {
  void navigator.clipboard.writeText(text).then(
    () => { toast.success(done); },
    () => { toast.error('Could not copy to the clipboard'); },
  );
}

export interface ConversationHeaderMenuProps {
  /** The menu stays mounted so its delivery-method state outlives a close; only the surface is gated. */
  open: boolean;
  conversation: Conversation;
  agentId?: string;
  viewMode: ViewMode;
  convMutations: ReturnType<typeof useConversationMutations>;
  archivePending: boolean;
  /** Present when the panel may archive; runs the panel's archive handler after the confirm. */
  onArchive?: () => void;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** The phone app (PAN-4837): hide what its phone token cannot do. */
  native: boolean;
  aboutOpen: boolean;
  onToggleAbout: () => void;
  hideToolCalls: boolean;
  onToggleHideToolCalls: () => void;
  /** Regenerate title — the mutation lives in the header, whose title shows its pending state. */
  retitlePending: boolean;
  onRetitle: () => void;
}

/** The header's ⋯ menu (PAN-5291 D1-3): view toggles, the conversation's actions, Advanced, and the end-of-life actions. */
export function ConversationHeaderMenu({
  open,
  conversation,
  agentId,
  viewMode,
  convMutations,
  archivePending,
  onArchive,
  onClose,
  triggerRef,
  native,
  aboutOpen,
  onToggleAbout,
  hideToolCalls,
  onToggleHideToolCalls,
  retitlePending,
  onRetitle,
}: ConversationHeaderMenuProps) {
  const confirm = useConfirm();
  const [deliveryMethod, setDeliveryMethod] = useState(conversation.deliveryMethod ?? 'auto');
  const [deliveryMethodSaving, setDeliveryMethodSaving] = useState(false);

  useEffect(() => {
    if (conversation.deliveryMethod && conversation.deliveryMethod !== deliveryMethod) {
      setDeliveryMethod(conversation.deliveryMethod);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.deliveryMethod]);

  const handleDeliveryMethodChange = useCallback(async (method: DeliveryMethod) => {
    setDeliveryMethodSaving(true);
    try {
      await updateConversationDeliveryMethod(conversation.name, method);
      setDeliveryMethod(method);
    } catch (err) {
      console.error('[ConversationPanel] Failed to update delivery method:', err);
    } finally {
      setDeliveryMethodSaving(false);
    }
  }, [conversation.name]);

  const handleExportTranscript = useCallback(async () => {
    // PAN-4558: the panel holds a window; export reads the whole transcript.
    let messages: MessagesResponse['messages'];
    try {
      messages = (await fetchFullTranscript(conversation.name, agentId)).messages;
    } catch {
      toast.error('Failed to export transcript');
      return;
    }
    if (messages.length === 0) {
      toast.error('No messages to export yet');
      return;
    }
    const md = messages
      .map((m) => `## ${m.role}\n\n${m.text ?? ''}\n`)
      .join('\n');
    const header = `# ${conversation.title ?? conversation.name}\n\n`;
    const blob = new Blob([header + md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(conversation.title ?? conversation.name).replace(/[^\w.-]+/g, '-')}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Transcript exported');
  }, [agentId, conversation.title, conversation.name]);

  // The session file id, kept reachable now that the status line no longer shows it (D1-4).
  const sessionId = conversation.sessionFile?.split('/').pop()?.replace('.jsonl', '') ?? null;

  const handleCopyLink = useCallback(() => {
    const params = new URLSearchParams();
    if (viewMode === 'terminal') {
      params.set('view', 'terminal');
    }
    const query = params.toString();
    copyText(`${window.location.origin}/conv/${conversation.id}${query ? `?${query}` : ''}`, 'Copied link');
  }, [conversation.id, viewMode]);

  // Open the conversation in a new browser window (formerly the header's
  // Detach button). Mirrors Stage's drag-off-to-detach so both entry points
  // land on the same /popout/conversation/<id> route — a bare conversation
  // view with no dashboard chrome (sidebar, awareness rail, etc.).
  const handleOpenInNewWindow = useCallback(() => {
    const params = new URLSearchParams();
    if (viewMode === 'terminal') params.set('view', 'terminal');
    const query = params.toString();
    const url = `/popout/conversation/${conversation.id}${query ? `?${query}` : ''}`;
    window.open(url, '_blank', 'popup=yes,width=920,height=1040');
  }, [conversation.id, viewMode]);

  const openHandoffDoc = useCallback(() => {
    window.open(`/api/conversations/${encodeURIComponent(conversation.name)}/handoff-doc`, '_blank', 'noopener,noreferrer');
  }, [conversation.name]);

  const openHandoffTarget = useCallback(() => {
    if (conversation.handoffTargetConvId) {
      window.location.href = `/conv/${conversation.handoffTargetConvId}`;
    }
  }, [conversation.handoffTargetConvId]);

  if (!open) return null;

  return (
    <>
      <MenuOverlay onClick={onClose} />
      <MenuSurface
        aria-label="Conversation actions"
        onClose={onClose}
        returnFocusRef={triggerRef}
        className="absolute right-0 top-full z-[1000] mt-1 min-w-[220px]"
      >
        {/* Group 1 — what the pane shows (visible in the phone app too). */}
        <MenuItemButton
          role="menuitemcheckbox"
          aria-checked={aboutOpen}
          onClick={() => { onToggleAbout(); onClose(); }}
        >
          <Info size={14} />
          About this conversation
        </MenuItemButton>
        <BookmarksMenuItem onDone={onClose} />
        <MenuItemButton
          role="menuitemcheckbox"
          aria-checked={!hideToolCalls}
          onClick={() => { onToggleHideToolCalls(); onClose(); }}
        >
          <Wrench size={14} />
          <span>Show tool calls</span>
          <span className="ml-auto text-muted-foreground">{hideToolCalls ? 'off' : 'on'}</span>
        </MenuItemButton>

        {/* Group 2 — copy and open (visible in the phone app too). */}
        <MenuSeparator />
        {!native && <OpenFolderMenuItems conversation={conversation} onDone={onClose} />}
        <MenuItemButton onClick={() => { copyText(conversation.name, 'Copied conversation id'); onClose(); }}>
          <Hash size={14} />
          <span>Copy conversation id</span>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">{conversation.name}</span>
        </MenuItemButton>
        {sessionId && sessionId !== conversation.name && (
          <MenuItemButton onClick={() => { copyText(sessionId, 'Copied session id'); onClose(); }}>
            <Hash size={14} />
            <span>Copy session id</span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">{sessionId.slice(0, 8)}</span>
          </MenuItemButton>
        )}
        <MenuItemButton onClick={() => { handleCopyLink(); onClose(); }}>
          <Copy size={14} />
          Copy link
        </MenuItemButton>
        <MenuItemButton onClick={() => { handleOpenInNewWindow(); onClose(); }}>
          <ExternalLink size={14} />
          Open in new window
        </MenuItemButton>

        {!native && (<>
        {/* Group 3 — the conversation's own state. */}
        <MenuSeparator />
        <MenuItemButton
          active={conversation.isFavorited}
          onClick={() => { convMutations.toggleFavorite({ name: conversation.name, favorited: !!conversation.isFavorited }); onClose(); }}
        >
          <Star size={14} style={{ fill: conversation.isFavorited ? 'currentColor' : 'none' }} />
          {conversation.isFavorited ? 'Unfavorite' : 'Favorite'}
        </MenuItemButton>
        <MenuItemButton
          onClick={() => { onRetitle(); onClose(); }}
          disabled={retitlePending}
        >
          {retitlePending
            ? <Loader2 size={14} className={styles.spinnerIcon} />
            : <Sparkles size={14} />}
          Regenerate title
        </MenuItemButton>
        <PullRequestMenuItems conversation={conversation} mutations={convMutations} onClose={onClose} />

        {/* Group 4 — hand the work somewhere else. */}
        <MenuSeparator />
        {conversation.claudeSessionId && (
          <MenuItemButton
            onClick={() => { convMutations.openForkModal(conversation, { mode: 'handoff' }); onClose(); }}
          >
            <Share2 size={14} />
            Hand off to new conversation
          </MenuItemButton>
        )}
        {conversation.claudeSessionId && conversation.harness !== 'pi' && (
          <MenuItemButton
            onClick={() => { convMutations.openForkModal(conversation); onClose(); }}
          >
            <GitBranchPlus size={14} />
            Create summary fork
          </MenuItemButton>
        )}
        <MenuItemButton
          onClick={() => { void handleExportTranscript(); onClose(); }}
        >
          <Download size={14} />
          Export transcript
        </MenuItemButton>
        <PullHereButton conversation={conversation} menu onDone={onClose} />
        {runsHere(conversation) && (
          <MenuItemButton onClick={() => { openContinueOnDevice(continueTargetOf(conversation, viewMode === 'terminal' ? 'terminal' : 'conversation')); onClose(); }}>
            <MonitorSmartphone size={14} />
            Continue on another device
          </MenuItemButton>
        )}
        <ShareConversationMenuItem conversation={conversation} onDone={onClose} />
        {conversation.handoffDocPath && (
          <MenuItemButton
            onClick={() => { openHandoffDoc(); onClose(); }}
          >
            <FileText size={14} />
            Open handoff doc
          </MenuItemButton>
        )}
        {conversation.handoffTargetConvId && (
          <MenuItemButton
            onClick={() => { openHandoffTarget(); onClose(); }}
          >
            <ExternalLink size={14} />
            Open handoff target
          </MenuItemButton>
        )}

        {/* Group 5 — Advanced: the message transport, unchanged (parent PRD D-6). */}
        {conversation.harness === 'claude-code' && (<>
          <MenuSeparator />
          <div className="eyebrow px-3 pb-0.5 pt-1">Advanced</div>
          <div className={styles.headerMenuDeliveryRow}>
            <span>Delivery method</span>
            <select
              className={styles.deliveryMethodSelect}
              value={deliveryMethod}
              onChange={(e) => handleDeliveryMethodChange(e.target.value as DeliveryMethod)}
              disabled={deliveryMethodSaving}
              title="Message delivery method"
              aria-label="Message delivery method"
            >
              <option value="auto">Auto</option>
              <option value="channels">Channels</option>
              <option value="tmux">Tmux</option>
            </select>
          </div>
        </>)}
        </>)}

        {/* Group 6 — end the conversation. */}
        {((onArchive && !native) || conversation.sessionAlive) && (
          <MenuSeparator />
        )}
        {onArchive && !native && (
          <MenuItemButton
            destructive
            disabled={archivePending}
            onClick={async () => {
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
              if (ok) onArchive();
            }}
          >
            {archivePending ? <Loader2 size={14} className={styles.spinnerIcon} /> : <Archive size={14} />}
            {archivePending ? 'Archiving…' : 'Archive conversation'}
          </MenuItemButton>
        )}
        {conversation.sessionAlive && (
          <MenuItemButton
            onClick={() => { convMutations.stop(conversation.name); onClose(); }}
          >
            <Square size={14} />
            Stop the agent
          </MenuItemButton>
        )}
      </MenuSurface>
    </>
  );
}
