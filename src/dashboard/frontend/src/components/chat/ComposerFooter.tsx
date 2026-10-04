/**
 * ComposerFooter (PAN-451)
 *
 * The message composition area at the bottom of the ConversationPanel.
 * Layout:
 *   ┌───────────────────────────────────────┐
 *   │  ComposerPromptEditor (Lexical)       │
 *   ├──────────────────────────────────────-┤
 *   │  [ModelPicker]  [EffortPicker]  [Send]│
 *   └───────────────────────────────────────┘
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { AlertCircle, FileText, Mic, MicOff, Paperclip, Scissors, SendHorizontal, X, Loader2 } from 'lucide-react';
import type { ClipboardEvent, ChangeEvent, DragEvent } from 'react';
import { toast } from 'sonner';
import { getHarnessBehavior } from '@overdeck/contracts';
import { isServerWriteBlocked } from '../../lib/connectionState';
import type { LexicalEditor } from 'lexical';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { ComposerPromptEditor, loadDraft } from './ComposerPromptEditor';
import { VoiceWidget } from './VoiceWidget';
import { ModelPicker, MODEL_EFFORT_SUPPORT, saveStoredHarness, saveStoredModel } from './ModelPicker';
import { pickerEffortLevels } from '../shared/ModelPicker';
import type { Harness } from '../shared/ModelPicker';
import { getDefaultConversationModel } from './defaultConversationModel';
import { modelSupportsImages, findModelDef } from '../Settings/modelCatalog';
import { EffortPicker } from './EffortPicker';
import { useComposerEffort, type EffortResolution } from './useComposerEffort';
import { ContextWindowMeter } from './ContextWindowMeter';
import { VaultContinueDialog } from './VaultContinueDialog';
import { VaultContinuityNotice } from './VaultContinuityNotice';
import { HandoffNotice } from './HandoffNotice';
import { HeldKickoffConflictError, HeldKickoffNotice, kickoffUnchanged, startHeldKickoff, useHeldKickoff, useSeedHeldKickoff } from './heldKickoff';
import { openImageLightbox, useImageLightboxStore } from './ImageLightbox';
import { useHandoffNotice } from './continueOnDevice/handoffNoticeStore';
import type { ContextWindowSnapshot } from '../../lib/contextWindow';
import type { Conversation } from '../CommandDeck/ConversationList';
import type { SubagentRoutingNotice } from '../../lib/subagentRouting';
import {
  useComposerStore,
  useConversationSending,
  useConversationAttachments,
  getConversationAttachments,
  sendConversationMessage,
  sendFailureDetails,
  getAttachmentAccept,
  MessageSendError,
  type SendFailureDetails,
} from '../../lib/composerStore';
import { classifyAttachmentKind, isDotfileAttachment, isExtensionlessAttachment } from '../../lib/attachmentTypes';
import styles from '../CommandDeck/styles/command-deck.module.css';

// Pending-attachment state and its upload pump live in `lib/composerStore.ts` so they
// survive a pane unmount (PAN-1591 renders only the active pane). `PendingAttachment`,
// the upload/delete API, and `revokePreviewUrl` moved there with them.

// ─── Props ────────────────────────────────────────────────────────────────────

interface ComposerFooterProps {
  conversation: Conversation;
  /** Called with the message text the instant it is sent — use for optimistic display */
  onSend?: (text: string, clientMessageId?: string) => void;
  /** Called after the send POST resolves successfully. */
  onSendAcknowledged?: (text: string, clientMessageId?: string) => void;
  /** Called when the POST fails — parent preserves the original prompt/command lane. */
  onSendFailed?: (text: string, kind: 'command' | 'prompt', details?: SendFailureDetails) => void;
  /** Agent ID for agent sessions (uses /api/agents/* endpoints instead of /api/conversations/*) */
  agentId?: string;
  /**
   * Current context-window snapshot for this conversation. Rendered as a
   * `<ContextWindowMeter>` in the toolbar right-cluster, mirroring t3code's
   * placement (right side, just before the send button).
   */
  contextWindowUsage?: ContextWindowSnapshot | null;
  /** True while the runtime is mid-turn. Used to choose Pi delivery defaults. */
  agentBusy?: boolean;
  /** Claude Code's agent selector shows a subagent, not the main agent,
   * receiving typed input (PAN-4268). */
  subagentNotice?: SubagentRoutingNotice;
  /** Effort read from the session transcript (PAN-4255). */
  observedEffort?: string | null;
  /** Agent-backed panels: the agent's launch/pinned effort and its source (PAN-4255). */
  effortResolution?: EffortResolution | null;
}

type DeliverAs = 'auto' | 'steer' | 'follow_up';

/** PAN-4292 D1: what Steer means for Claude Code, shown on the selector while Steer is chosen. */
const CLAUDE_STEER_TOOLTIP = 'Steer: interrupt the current turn and send now (Claude Code Ctrl+Enter). Auto queues the message for the running turn.';

function isPiConversation(conversation: Conversation): boolean {
  return conversation.harness === 'ohmypi' || conversation.harness === 'pi';
}

function openComposerUi(
  conversation: Conversation,
  action: 'handoff' | 'fork',
  focus?: string,
): void {
  window.dispatchEvent(new CustomEvent('overdeck:open-fork-modal', {
    detail: {
      conversation,
      mode: action === 'handoff' ? 'handoff' : 'summary',
      focus,
    },
  }));
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  const value = bytes / Math.pow(1000, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

function ComposerFooterInput({
  conversation,
  onSend,
  onSendAcknowledged,
  onSendFailed,
  agentId,
  contextWindowUsage = null,
  agentBusy = false,
  subagentNotice = null,
  observedEffort = null,
  effortResolution = null,
}: ComposerFooterProps) {
  const [model, setModel] = useState<string>(conversation.model ?? getDefaultConversationModel());
  // Existing conversations are bound to the harness they were spawned with.
  // Falling back to a global localStorage default here caused the picker to
  // display the *last globally-picked* harness for any conversation whose
  // harness column was null, then send that harness on the next /switch-model
  // call — silently rewriting the conversation's runtime. Default to
  // 'claude-code' (the safe runtime) when the conversation has no stored
  // harness; do NOT consult localStorage.
  const [harness, setHarness] = useState<Harness>((conversation.harness === 'pi' ? 'ohmypi' : conversation.harness) ?? 'claude-code');
  const [deliverAs, setDeliverAs] = useState<DeliverAs>('auto');
  const [compactPending, setCompactPending] = useState(false);
  // `sending`, pending attachments, and their upload pump live in the module-level
  // composerStore, keyed by conversation name (the same key drafts use). The
  // PAN-1591 Stage renders only the active pane, so switching conversations
  // unmounts ComposerFooter entirely — any component-local state would be wiped.
  // Sourcing them from the store makes the "Sending…" indicator and pending
  // attachments follow their conversation and survive a switch away and back.
  const sending = useConversationSending(conversation.name);
  const pendingAttachments = useConversationAttachments(conversation.name);
  const setSendingFor = useComposerStore((s) => s.setSending);
  const enqueueAttachmentsForConversation = useComposerStore((s) => s.enqueueAttachments);
  const removeAttachmentForConversation = useComposerStore((s) => s.removeAttachment);
  const consumeAttachmentsForConversation = useComposerStore((s) => s.consumeAttachments);
  const addCommandResult = useComposerStore((s) => s.addCommandResult);
  const holdSend = useComposerStore((s) => s.holdSend);
  const heldKickoff = useHeldKickoff(conversation.name);

  const [text, setText] = useState('');
  const [isVoiceWidgetOpen, setIsVoiceWidgetOpen] = useState(false);
  const [voiceAutoStartToken, setVoiceAutoStartToken] = useState(0);
  const [voiceState, setVoiceState] = useState<{ isListening: boolean; error: string | null }>({ isListening: false, error: null });
  const editorRef = useRef<LexicalEditor | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previousConversationNameRef = useRef(conversation.name);
  // PAN-4493 D10: tracks which pending attachment (if any) owns the currently
  // open lightbox, so removing that attachment closes it — without closing a
  // lightbox some other composer or sent message opened.
  const lightboxOwnerRef = useRef<{ id: string; src: string } | null>(null);
  // Updated synchronously on every render so the in-flight-send guards below see
  // the currently-mounted conversation immediately (PAN-539 attribution race).
  const currentConversationNameRef = useRef(conversation.name);
  currentConversationNameRef.current = conversation.name;
  useSeedHeldKickoff(editorRef.current, conversation.name, heldKickoff.held, heldKickoff.text);

  const piConversation = isPiConversation(conversation);
  const { effort, chip: effortChip, pending: effortPending, liveChangeEnabled, title: effortTitle, onChange: handleEffortChange } =
    useComposerEffort({ conversation, agentId, harness, model, piConversation, observedEffort, effortResolution });
  // PAN-4292: the delivery selector follows the harness steer capability. Pi
  // steers over its control channel, which only the conversation route
  // carries; Claude Code steers with send-now keys on both routes.
  const steerKind = getHarnessBehavior(harness).steerKind;
  const showDeliverySelector = steerKind === 'send-now-keys' || (steerKind === 'control-channel' && !agentId);
  const steerOptionLabel = navigator.platform.toLowerCase().includes('mac') ? 'Steer (⌘+Enter)' : 'Steer (Ctrl+Enter)';
  const isDisabled = !conversation.sessionAlive || sending;
  const canEditModelBeforeStart = !agentId && !conversation.sessionAlive && !conversation.claudeSessionId;
  const isEmpty = text.trim() === '';

  // Attachments are pasted/dropped into the active composer, so conversation.name is
  // the owning conversation. The store stamps it onto each attachment for async
  // upload attribution.
  //
  // Vision gating: non-vision models can't read images, but text/PDF/code files
  // are still useful. Filter image files out client-side for those models so the
  // user gets a clear toast instead of a server-side silent drop.
  const enqueueAttachments = useCallback((files: File[]) => {
    const imageFiles: File[] = [];
    const nonImageFiles: File[] = [];
    for (const file of files) {
      if (classifyAttachmentKind(file) === 'image') {
        imageFiles.push(file);
      } else {
        nonImageFiles.push(file);
      }
    }

    if (imageFiles.length > 0 && !modelSupportsImages(model)) {
      const def = findModelDef(model);
      toast.warning(
        `${def?.name ?? model} can't read images — image${imageFiles.length === 1 ? '' : 's'} not attached. ` +
        `Switch to a vision-capable model (e.g. MiMo V2.5) to send images.`,
      );
    }

    const filesToEnqueue = modelSupportsImages(model) ? files : nonImageFiles;
    const { rejected } = enqueueAttachmentsForConversation(conversation.name, filesToEnqueue);
    if (rejected.length > 0) {
      const dotfiles = rejected.filter((file) => isDotfileAttachment(file.name));
      const extensionless = rejected.filter((file) => isExtensionlessAttachment(file.name));
      const other = rejected.filter(
        (file) => !isDotfileAttachment(file.name) && !isExtensionlessAttachment(file.name),
      );

      const joinedNames = (files: File[]) => files.map((file) => file.name).join(', ');

      if (dotfiles.length > 0) {
        toast.warning(`${joinedNames(dotfiles)} not supported (dotfile).`);
      }
      if (extensionless.length > 0) {
        toast.warning(`${joinedNames(extensionless)} not supported (extensionless file).`);
      }
      if (other.length > 0) {
        toast.warning(`${joinedNames(other)} not supported.`);
      }
    }
  }, [enqueueAttachmentsForConversation, conversation.name, model]);

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length > 0) {
      enqueueAttachments(files);
    }
    // Reset the input so the same file can be selected again.
    event.target.value = '';
  }, [enqueueAttachments]);

  const removePendingAttachment = useCallback((id: string) => {
    removeAttachmentForConversation(conversation.name, id);
  }, [removeAttachmentForConversation, conversation.name]);

  // Existing sessions are model-locked. This handler is only reachable while
  // composing before a session exists, so it updates local draft defaults only.
  const handleHarnessChange = useCallback((newHarness: Harness) => {
    if (newHarness === harness) return;
    setHarness(newHarness);
    saveStoredHarness(newHarness);
  }, [harness]);

  const handleModelChange = useCallback((newModel: string, _effortLevels: readonly string[]) => {
    setModel(newModel);
    saveStoredModel(newModel);
  }, []);

  /**
   * Atomic model+harness swap. Used by the picker's auto-resolve flow before a
   * runtime session exists.
   */
  const handleComboChange = useCallback((newModel: string, _effortLevels: readonly string[], newHarness: Harness) => {
    setModel(newModel);
    saveStoredModel(newModel);
    setHarness(newHarness);
    saveStoredHarness(newHarness);
  }, []);

  const handleCompact = useCallback(() => {
    if (!piConversation || agentId || compactPending) return;
    setCompactPending(true);
    void (async () => {
      const res = await fetch(`/api/conversations/${encodeURIComponent(conversation.name)}/compact`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to compact conversation (${res.status})${body ? `: ${body}` : ''}`);
      }
      toast.success('Compaction requested');
    })().catch((err: unknown) => {
      console.error('[ComposerFooter] Failed to compact:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to compact conversation');
    }).finally(() => {
      setCompactPending(false);
    });
  }, [agentId, compactPending, conversation.name, piConversation]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (sending) {
      event.preventDefault();
      return;
    }
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    // Harvest files from the canonical surface first:
    //  - clipboardData.files: the FileList of files in this paste
    //  - clipboardData.items (kind:'file'): per-item access; only consulted when
    //    .files is empty (some Wayland Chromium screenshot-tool pastes).
    const collected: File[] = [];
    const filesFromFiles = clipboardData.files ? Array.from(clipboardData.files) : [];
    if (filesFromFiles.length > 0) {
      collected.push(...filesFromFiles);
    } else if (clipboardData.items) {
      for (const item of Array.from(clipboardData.items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) collected.push(file);
        }
      }
    }

    if (collected.length > 0) {
      event.preventDefault();
      enqueueAttachments(collected);
      return;
    }

    // Nothing in the synchronous DataTransfer surfaces. Decide whether to
    // intervene further or let the paste fall through to Lexical.
    const types = Array.from(clipboardData.types ?? []);
    const hasImageType = types.some((t) => t.startsWith('image/'));
    const hasFilesType = types.includes('Files'); // Chrome legacy marker for file pastes
    const hasUriList = types.includes('text/uri-list');

    // Case A: clipboard claims to carry image bytes but DataTransfer was empty.
    // This is the Wayland Chromium screenshot-paste bug (PAN-539 regression on
    // 2026-05-25). Recovery requires the async Clipboard API, which will
    // trigger a permission prompt on first use — acceptable here because the
    // alternative is silent failure.
    if (hasImageType || hasFilesType) {
      event.preventDefault();
      if (typeof navigator !== 'undefined' && navigator.clipboard?.read) {
        void (async () => {
          try {
            const items = await navigator.clipboard.read();
            const recovered: File[] = [];
            for (const item of items) {
              for (const type of item.types) {
                if (!type.startsWith('image/')) continue;
                const blob = await item.getType(type);
                const ext = type.split('/')[1]?.split('+')[0] || 'png';
                recovered.push(new File([blob], `paste-${Date.now()}.${ext}`, { type }));
              }
            }
            if (recovered.length > 0) {
              enqueueAttachments(recovered);
            } else {
              toast.error('Couldn\'t read the pasted image. Try saving it to a file and dragging it onto the composer.');
            }
          } catch {
            toast.error('Clipboard read denied. Grant clipboard permission, or drag the image onto the composer instead.');
          }
        })();
      } else {
        toast.error('Couldn\'t read the pasted image. Try dragging the file onto the composer instead.');
      }
      return;
    }

    // Case B: file pasted from a file manager (text/uri-list). Browsers can't
    // read file:// URIs from web origins, so async-clipboard won't help here.
    // Tell the user to drag instead.
    if (hasUriList) {
      event.preventDefault();
      toast.error('Paste-from-file-manager isn\'t supported. Drag the file onto the composer instead.');
    }

    // Otherwise this is a regular text paste — pass through unchanged.
  }, [enqueueAttachments, sending]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (sending || !conversation.sessionAlive) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    enqueueAttachments(files);
  }, [enqueueAttachments, sending, conversation.sessionAlive]);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    const items = Array.from(event.dataTransfer.items);
    // Accept any file-kind drag (files don't expose their MIME type during dragover —
    // type is empty until drop on most browsers).
    if (items.some((item) => item.kind === 'file')) {
      event.preventDefault();
    }
  }, []);

  const handleSubmit = useCallback(async (directMessageText?: string, deliverAsOverride?: 'steer') => {
    const editor = editorRef.current;
    if (!editor) {
      console.warn('[ComposerFooter] handleSubmit: editor ref not ready');
      return;
    }
    if (isDisabled) {
      console.warn('[ComposerFooter] handleSubmit: isDisabled=true, sessionAlive=%s sending=%s', conversation.sessionAlive, sending);
      return;
    }

    let messageText = directMessageText?.trim() ?? '';
    if (directMessageText === undefined) {
      editor.read(() => {
        messageText = $getRoot().getTextContent().trim();
      });
    }

    // Intercept slash-prefixed handoff invocations and open the fork modal
    // pre-set to handoff mode for the current conversation. Matches:
    //   /handoff
    //   /handoff <focus text…>
    //   /pan-handoff
    //   /pan-handoff <focus text…>
    //   /pan handoff
    //   /pan handoff <focus text…>
    // The leading slash is required — it's the convention that distinguishes
    // dashboard UI actions from messages bound for the agent. Unprefixed
    // `pan handoff …` falls through to the agent which runs the CLI directly
    // in its Bash tool. Any trailing text after the verb becomes the focus
    // and pre-fills the dialog's Focus textarea.
    const handoffMatch = messageText.match(/^\/(?:pan[\s-])?handoff(?:\s+(.+))?$/i);
    if (handoffMatch) {
      const focus = handoffMatch[1]?.trim() || undefined;
      openComposerUi(conversation, 'handoff', focus);
      editor.update(() => {
        $getRoot().clear();
      });
      setText('');
      return;
    }

    // PAN-4499 D12: Send on a held conversation starts it through the kickoff
    // door instead of the message route — never both.
    if (heldKickoff.held) {
      const holdConversationName = conversation.name;
      setSendingFor(holdConversationName, true);
      try {
        await startHeldKickoff(holdConversationName, kickoffUnchanged(messageText, heldKickoff.text) ? undefined : messageText);
        if (holdConversationName === currentConversationNameRef.current) {
          editor.update(() => { $getRoot().clear(); });
          setText('');
        }
        heldKickoff.refresh();
      } catch (err) {
        if (err instanceof HeldKickoffConflictError) {
          toast.error('This conversation was already started');
          heldKickoff.refresh();
        } else {
          console.error('[ComposerFooter] Failed to start held conversation:', err);
          toast.error(err instanceof Error ? err.message : 'Failed to start conversation');
        }
      } finally {
        setSendingFor(holdConversationName, false);
        editor.focus();
      }
      return;
    }

    const submitConversationName = conversation.name;

    // Re-read pending attachments before any async work — if uploads are still in
    // progress we must return early without switching model or sending. Read
    // this conversation's slice from the store (synchronous, unmount-proof).
    const currentPendingAttachments = getConversationAttachments(submitConversationName);
    const uploadingAttachments = currentPendingAttachments.filter((attachment) => !attachment.serverPath && !attachment.error);
    if (uploadingAttachments.length > 0) {
      toast.error('Please wait for uploads to finish');
      return;
    }

    const failedAttachments = currentPendingAttachments.filter((attachment) => attachment.error);
    if (failedAttachments.length > 0) {
      toast.error('Remove failed uploads before sending');
      return;
    }

    const uploadedAttachments = currentPendingAttachments.filter((attachment) => attachment.serverPath);
    if (!messageText && uploadedAttachments.length === 0) return;

    setSendingFor(submitConversationName, true);
    const attachmentPrefix = uploadedAttachments
      .map((attachment) => `@${attachment.serverPath}`)
      .join('\n');
    const composedMessage = [attachmentPrefix, messageText].filter(Boolean).join('\n');
    const isPortableCommand = /^\/pan(?:\s|$)/i.test(messageText);
    // Attachments belong to the prompt lane. Portable commands stay in the
    // control-plane lane and leave any uploaded attachments pending.
    const submissionMessage = isPortableCommand ? messageText : composedMessage;
    const clientMessageId = crypto.randomUUID();
    // Follow-up exists only on the Pi control channel.
    const selectedDeliverAs = deliverAs === 'follow_up' && steerKind !== 'control-channel' ? undefined : deliverAs;
    const sendDeliverAs = deliverAsOverride ?? (showDeliverySelector && selectedDeliverAs !== 'auto' ? selectedDeliverAs : undefined);
    try {
      // DISABLED 2026-06-16: a plain message-send must NEVER switch the model.
      // This auto-switch silently killed a running agent's live session (the Opus
      // planning takeover on PAN-1847): the picker showed a hardcoded gpt-5.5
      // default (ConversationPanel.tsx `|| getDefaultConversationModel()`) because
      // the agent's real model wasn't reflected, that mismatched the agent's actual
      // model, and submitting a message tore down its session. Model changes are now
      // an EXPLICIT picker action only. Do NOT re-enable a submit-time switch without
      // (a) the picker reflecting the agent's true model and (b) an explicit confirm.

      // Abort if conversation switched during the async model switch. Leave the
      // pending attachments in their owning conversation (they persist now) so they
      // survive for a retry when the user returns — do not revoke or delete.
      if (submitConversationName !== currentConversationNameRef.current) {
        return;
      }

      // Degraded mode (PAN-4279): while the server is unreachable a prompt is
      // held and sent on reconnect; a command needs a live round trip, so it
      // keeps its draft instead.
      if (isServerWriteBlocked()) {
        if (isPortableCommand) {
          toast.error("Can't reach the Overdeck server — commands need a live connection");
          return;
        }
        holdSend(submitConversationName, composedMessage, {
          clientMessageId,
          deliverAs: sendDeliverAs,
        });
        consumeAttachmentsForConversation(submitConversationName);
        editor.update(() => {
          $getRoot().clear();
        });
        setText('');
        return;
      }

      // The `/pan` namespace is intercepted by the dashboard control plane and
      // returns a structured result. It must never appear as an optimistic user
      // prompt or reach the harness transcript.
      if (!isPortableCommand) onSend?.(composedMessage, clientMessageId);

      const commandResult = await sendConversationMessage(
        submitConversationName,
        submissionMessage,
        agentId,
        sendDeliverAs,
        undefined,
        {
          clientMessageId,
          // PAN-4292 NFR-4: never let a steer degrade to a queued message silently.
          onSteerDegraded: (reason) => toast.warning(`Sent without interrupting: ${reason}`),
        },
      );
      if (commandResult?.kind === 'ui') {
        openComposerUi(
          conversation,
          commandResult.action,
          commandResult.args.focus || undefined,
        );
      } else if (commandResult) {
        addCommandResult(submitConversationName, submissionMessage, commandResult);
      } else {
        onSendAcknowledged?.(submissionMessage, clientMessageId);
      }

      // The send consumed this conversation's attachments — revoke their previews and
      // drop them from the store. Target submitConversationName explicitly so the
      // right conversation is cleared even if the user switched while the send
      // was in flight. The sent message references the server uploads by @path,
      // so consumeAttachments does NOT delete them server-side.
      if (!isPortableCommand) {
        consumeAttachmentsForConversation(submitConversationName);
      }

      // Only clear the editor if still on the same conversation, to avoid wiping
      // the new conversation's draft if the user switched while the send was in
      // flight.
      if (submitConversationName === currentConversationNameRef.current) {
        editor.update(() => {
          $getRoot().clear();
        });
        setText('');
      }
    } catch (err) {
      // PAN-4278: a permission prompt is up, so the server pasted nothing. The
      // bubble waits as 'held' and resends itself once the prompt clears.
      if (!isPortableCommand && err instanceof MessageSendError && err.code === 'permission-pending') {
        useComposerStore.getState().hold(submitConversationName, clientMessageId);
        consumeAttachmentsForConversation(submitConversationName);
        if (submitConversationName === currentConversationNameRef.current) {
          editor.update(() => { $getRoot().clear(); });
          setText('');
        }
        return;
      }
      console.error('[ComposerFooter] Failed to send:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to send message');
      onSendFailed?.(submissionMessage, isPortableCommand ? 'command' : 'prompt', {
        ...sendFailureDetails(err), clientMessageId,
        deliverAs: sendDeliverAs,
      });
    } finally {
      // Clear the originating conversation's sending state regardless of which
      // conversation is now mounted — the send belonged to submitConversationName.
      setSendingFor(submitConversationName, false);
      // Refocus editor
      editor.focus();
    }
  }, [addCommandResult, agentId, conversation, consumeAttachmentsForConversation, deliverAs, harness, heldKickoff, holdSend, isDisabled, model, onSend, onSendAcknowledged, onSendFailed, sending, setSendingFor, showDeliverySelector, steerKind]);

  useEffect(() => {
    const previousConversationName = previousConversationNameRef.current;
    if (previousConversationName === conversation.name) {
      return;
    }

    previousConversationNameRef.current = conversation.name;
    // Do NOT touch pending attachments or sending here. Both live in the
    // composerStore keyed per-conversation, so an attachment pasted into one
    // conversation — or a send still in flight — survives navigating away and
    // back. In-flight uploads attach to their owning conversation; the send's
    // own finally clears its sending flag by submitConversationName.
    setModel(conversation.model ?? getDefaultConversationModel());
    setHarness((conversation.harness === 'pi' ? 'ohmypi' : conversation.harness) ?? 'claude-code');
    // PAN-4292: a delivery mode belongs to the conversation it was picked in.
    // A Steer or Follow-up choice must not carry over to the next conversation
    // this reused pane shows.
    setDeliverAs('auto');
    // Do NOT clear the editor here. The inner LexicalComposer is keyed by
    // conversation.name, so it already remounts on a conversation switch and
    // seeds the new conversation's saved draft via initialConfig. Calling
    // $getRoot().clear() would wipe that just-loaded draft AND the resulting
    // onChange('') would delete it from localStorage — losing the user's typed
    // text whenever they navigate away and back (the pane is reused across
    // switches, so this effect fires after the remount). Instead, sync our
    // local `text` mirror (used for the send-button enabled state) to the new
    // conversation's draft, since OnChangePlugin does not fire for the seeded
    // initial editor state.
    setText(loadDraft(conversation.name));
  }, [conversation.name, conversation.model]);

  const insertVoiceText = useCallback((voiceText: string) => {
    const trimmed = voiceText.trim();
    if (!trimmed) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.update(() => {
      const root = $getRoot();
      const existing = root.getTextContent().trim();
      root.clear();
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode([existing, trimmed].filter(Boolean).join(existing ? '\n' : '')));
      root.append(paragraph);
    });
    setText((existing) => [existing.trim(), trimmed].filter(Boolean).join(existing.trim() ? '\n' : ''));
    editor.focus();
  }, []);

  useEffect(() => {
    const handleVoiceShortcut = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes('mac');
      const usesModifier = isMac ? event.metaKey : event.ctrlKey;
      if (!usesModifier || !event.shiftKey || event.altKey || event.key.toLowerCase() !== 'm') return;
      if (isDisabled) return;
      event.preventDefault();
      setIsVoiceWidgetOpen(true);
      setVoiceAutoStartToken((token) => token + 1);
    };

    window.addEventListener('keydown', handleVoiceShortcut);
    return () => window.removeEventListener('keydown', handleVoiceShortcut);
  }, [isDisabled]);

  // PAN-4493 D10: if the attachment that opened the lightbox is gone (removed
  // or finished uploading away its preview), close it — but never a lightbox
  // some other composer or sent message opened.
  useEffect(() => {
    const owner = lightboxOwnerRef.current;
    if (!owner) return;
    const stillPending = pendingAttachments.some((attachment) => attachment.id === owner.id);
    if (stillPending) return;
    if (useImageLightboxStore.getState().image?.src === owner.src) {
      useImageLightboxStore.getState().close();
    }
    lightboxOwnerRef.current = null;
  }, [pendingAttachments]);

  const handleCommandKey = useCallback(
    (key: 'Enter' | 'SteerEnter') => {
      // PAN-4292 D5: Ctrl/Cmd+Enter steers on a steer-capable harness, busy or
      // idle (an idle steer is a plain submit); elsewhere it is Enter.
      if (key === 'SteerEnter') void handleSubmit(undefined, showDeliverySelector ? 'steer' : undefined);
      else void handleSubmit();
    },
    [handleSubmit, showDeliverySelector],
  );

  return (
    <div className={styles.composerFooter}>
      {heldKickoff.held && <HeldKickoffNotice />}
      {/* Single unified container — T3Chat style */}
      <div className={styles.composerBox} onDrop={handleDrop} onDragOver={handleDragOver}>
        {pendingAttachments.length > 0 && (
          <div className={styles.composerImageStrip}>
            {pendingAttachments.map((attachment) => {
              const isUploading = !attachment.serverPath && !attachment.error;
              const statusLabel = attachment.error
                ? attachment.error
                : attachment.serverPath
                  ? 'Uploaded'
                  : 'Uploading…';
              return (
                <div key={attachment.id} className={styles.composerImageCard}>
                  {attachment.previewUrl ? (
                    <button
                      type="button"
                      className={styles.composerImageThumbButton}
                      onClick={() => {
                        lightboxOwnerRef.current = { id: attachment.id, src: attachment.previewUrl! };
                        openImageLightbox(attachment.previewUrl!, attachment.file.name);
                      }}
                      title={`View ${attachment.file.name}`}
                    >
                      <img src={attachment.previewUrl} alt={attachment.file.name} className={styles.composerImageThumb} />
                    </button>
                  ) : (
                    <div className={`${styles.composerImageThumb} ${styles.composerFileThumb}`} title={attachment.file.name}>
                      <FileText size={16} />
                    </div>
                  )}
                  <div className={styles.composerImageMeta}>
                    <span className={styles.composerImageName}>{attachment.file.name}</span>
                    <span className={attachment.error ? styles.composerImageError : styles.composerImageStatus}>
                      {isUploading ? <Loader2 size={12} className={styles.spinner} /> : null}
                      {statusLabel}
                      {attachment.kind === 'file' && !attachment.error && (
                        <span className={styles.composerFileSize}>· {formatFileSize(attachment.file.size)}</span>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.composerImageRemoveButton}
                    onClick={() => removePendingAttachment(attachment.id)}
                    title={`Remove ${attachment.file.name}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {subagentNotice && (
          <div
            role="status"
            className="badge-bg-warning badge-border-warning"
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '6px 10px', marginBottom: 4, borderRadius: 6,
              borderWidth: 1, borderStyle: 'solid',
              color: 'var(--warning-foreground)', fontSize: 12,
            }}
          >
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
              <span>
                {`Typed messages are going to subagent "${subagentNotice.description}", not the main agent.`}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={(isEmpty && pendingAttachments.filter((attachment) => !!attachment.serverPath).length === 0) || isDisabled}
                  title="Switches Claude Code back to the main agent, then sends your draft"
                >
                  Send to main
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Editor (no border of its own) */}
        <ComposerPromptEditor
          conversationName={conversation.name}
          harness={harness}
          disabled={isDisabled}
          onCommandKeyDown={handleCommandKey}
          editorRef={editorRef}
          onChange={setText}
          onPaste={handlePaste}
        />

        {/* Toolbar inside the box */}
        <div className={styles.composerToolbar}>
          <ModelPicker
            value={model}
            onChange={handleModelChange}
            onComboChange={handleComboChange}
            disabled={isDisabled || !canEditModelBeforeStart}
            harness={harness}
            onHarnessChange={handleHarnessChange}
            liveConversation={conversation.sessionAlive}
          />
          {/*
            Model drift indicator. The picker holds the model that the
            *next* message will be sent with; if the running session's last
            assistant turn used a different model (e.g. the user ran /model
            inside Claude Code, or Cloister auto-routed), surface it here so
            the picker doesn't silently lie about what's actually running.
          */}
          {contextWindowUsage?.lastModel && contextWindowUsage.lastModel !== model && (
            <span
              className={styles.composerToolbarModelDrift}
              title={`Last assistant turn ran as ${contextWindowUsage.lastModel}; the picker value applies to the next message you send.`}
              data-testid="composer-model-drift"
            >
              running: {contextWindowUsage.lastModel}
            </span>
          )}
          <div className={styles.composerToolbarDivider} />
          <EffortPicker chip={effortChip} pending={effortPending} title={effortTitle} value={effort} onChange={handleEffortChange} disabled={effortPending || !liveChangeEnabled} availableLevels={pickerEffortLevels(model) ?? MODEL_EFFORT_SUPPORT[model as keyof typeof MODEL_EFFORT_SUPPORT]} />

          {showDeliverySelector && (
            <select
              className={styles.deliveryMethodSelect}
              value={deliverAs}
              onChange={(event) => setDeliverAs(event.target.value as DeliverAs)}
              title={steerKind === 'control-channel'
                ? (agentBusy ? 'Pi delivery mode while busy' : 'Pi delivery mode')
                : (deliverAs === 'steer' ? CLAUDE_STEER_TOOLTIP : 'Delivery mode')}
              aria-label={steerKind === 'control-channel' ? 'Pi delivery mode' : 'Delivery mode'}
              disabled={!conversation.sessionAlive}
            >
              <option value="auto">Auto</option>
              <option value="steer">{steerOptionLabel}</option>
              {steerKind === 'control-channel' && <option value="follow_up">Follow-up</option>}
            </select>
          )}
          {piConversation && !agentId && (
            <>
              <button
                className={styles.voiceToolbarButton}
                onClick={handleCompact}
                disabled={!conversation.sessionAlive || compactPending}
                type="button"
                title="Compact context"
                aria-label="Compact context"
              >
                {compactPending ? <Loader2 size={16} className={styles.spinner} /> : <Scissors size={16} />}
              </button>
            </>
          )}

          <div className={styles.composerToolbarSpacer} />

          <button
            className={styles.voiceToolbarButton}
            onClick={handleAttachClick}
            disabled={isDisabled}
            type="button"
            title="Attach files"
            aria-label="Attach files"
          >
            <Paperclip size={16} />
          </button>

          <button
            className={isVoiceWidgetOpen ? styles.voiceToolbarButtonActive : styles.voiceToolbarButton}
            onClick={() => setIsVoiceWidgetOpen((open) => !open)}
            disabled={isDisabled}
            type="button"
            title={voiceState.error ? `Voice error: ${voiceState.error}` : voiceState.isListening ? 'Voice input listening' : 'Toggle voice input (Ctrl+Shift+M)'}
          >
            {voiceState.error ? <AlertCircle size={16} /> : voiceState.isListening ? <MicOff size={16} /> : <Mic size={16} />}
          </button>

          <ContextWindowMeter usage={contextWindowUsage} />

          <button
            className={styles.sendButton}
            onClick={() => void handleSubmit()}
            disabled={(isEmpty && pendingAttachments.filter((attachment) => !!attachment.serverPath).length === 0) || isDisabled}
            type="button"
            title="Send message (Enter)"
          >
            <SendHorizontal size={16} />
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={getAttachmentAccept()}
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
          data-testid="composer-attach-input"
        />
        {isVoiceWidgetOpen && (
          <VoiceWidget
            conversation={conversation}
            onInsert={insertVoiceText}
            onSendDirect={(voiceText) => void handleSubmit(voiceText)}
            onStateChange={setVoiceState}
            autoStartToken={voiceAutoStartToken}
          />
        )}
      </div>
    </div>
  );
}

/** Select a conversation the way /conv/<name> deep links do (client-side route). */
function openConversationRoute(name: string): void {
  window.history.pushState(null, '', `/conv/${encodeURIComponent(name)}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * PAN-4436: a Session Vault browse copy is read-only — show how to continue it
 * instead of an input. PAN-4437: "Continue here" continues it from the dashboard.
 */
function VaultReadOnlyNotice({ conversation }: { conversation: Conversation }) {
  const [continuing, setContinuing] = useState(false);
  const label = conversation.vaultOwnerLabel ?? 'another machine';
  const vaultId = conversation.name.startsWith('vault-') ? conversation.name.slice('vault-'.length) : conversation.name;
  return (
    <div className={styles.composerFooter}>
      <div className={styles.composerBox} role="status" data-testid="vault-read-only-notice">
        <div className={`${styles.composerEditor} ${styles.composerEditable}`}>
          <p>{`Read-only copy from ${label}.`}</p>
          <p>To continue it here, run: <code>{`pan vault resume ${vaultId}`}</code></p>
          <button
            type="button"
            aria-label="Continue here"
            className="mt-2 rounded-[var(--radius-sm)] border border-border px-3 py-1 text-[12px] hover:bg-accent"
            onClick={() => setContinuing(true)}
          >
            Continue here
          </button>
        </div>
      </div>
      {continuing && (
        <VaultContinueDialog vaultId={vaultId} onClose={() => setContinuing(false)} onContinued={openConversationRoute} />
      )}
    </div>
  );
}

export function ComposerFooter(props: ComposerFooterProps) {
  if (props.conversation.origin === 'vault') return <VaultReadOnlyNotice conversation={props.conversation} />;
  const continuity = props.conversation.vaultContinuity;
  if (continuity) {
    return (
      <>
        <VaultContinuityNotice continuity={continuity} onOpenCopy={openConversationRoute} />
        <ComposerFooterInput {...props} />
      </>
    );
  }
  return <ComposerFooterWithHandoff {...props} />;
}

/** PAN-4455 D-15/D-16: the hand-off notice, only when PAN-4447's continuity notice does not apply. */
function ComposerFooterWithHandoff(props: ComposerFooterProps) {
  const handoff = useHandoffNotice(props.conversation);
  return (
    <>
      {handoff && <HandoffNotice conversation={props.conversation} at={handoff.at} />}
      <ComposerFooterInput {...props} />
    </>
  );
}
