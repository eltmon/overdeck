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
import { AlertCircle, Mic, MicOff, Scissors, SendHorizontal, X, Loader2 } from 'lucide-react';
import type { ClipboardEvent, DragEvent } from 'react';
import { toast } from 'sonner';
import type { LexicalEditor } from 'lexical';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { ComposerPromptEditor, loadDraft } from './ComposerPromptEditor';
import { VoiceWidget } from './VoiceWidget';
import { ModelPicker, MODEL_EFFORT_SUPPORT, saveStoredHarness, saveStoredModel } from './ModelPicker';
import type { Harness } from '../shared/ModelPicker';
import { getDefaultConversationModel } from './defaultConversationModel';
import { modelSupportsImages, findModelDef } from '../Settings/modelCatalog';
import { EffortPicker, loadStoredEffort, type EffortLevel } from './EffortPicker';
import { ContextWindowMeter } from './ContextWindowMeter';
import type { ContextWindowSnapshot } from '../../lib/contextWindow';
import type { Conversation } from '../CommandDeck/ConversationList';
import {
  useComposerStore,
  useConversationSending,
  useConversationImages,
  getConversationImages,
  sendConversationMessage,
} from '../../lib/composerStore';
import styles from '../CommandDeck/styles/command-deck.module.css';

// Pasted-image state and its upload pump live in `lib/composerStore.ts` so they
// survive a pane unmount (PAN-1591 renders only the active pane). `PendingImage`,
// the upload/delete API, and `revokePreviewUrl` moved there with them.

// ─── Props ────────────────────────────────────────────────────────────────────

interface ComposerFooterProps {
  conversation: Conversation;
  /** Called with the message text the instant it is sent — use for optimistic display */
  onSend?: (text: string) => void;
  /** Called after the send POST resolves successfully. */
  onSendAcknowledged?: (text: string) => void;
  /** Called when the POST fails — parent should move the optimistic message to the failed outbox */
  onSendFailed?: (text: string) => void;
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
}

type DeliverAs = 'steer' | 'follow_up';

function isPiConversation(conversation: Conversation): boolean {
  return conversation.harness === 'ohmypi' || conversation.harness === 'pi';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ComposerFooter({
  conversation,
  onSend,
  onSendAcknowledged,
  onSendFailed,
  agentId,
  contextWindowUsage = null,
  agentBusy = false,
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
  const [effort, setEffort] = useState<EffortLevel>(loadStoredEffort);
  const [deliverAs, setDeliverAs] = useState<DeliverAs>('steer');
  const [compactPending, setCompactPending] = useState(false);
  // `sending`, pending images, and their upload pump live in the module-level
  // composerStore, keyed by conversation name (the same key drafts use). The
  // PAN-1591 Stage renders only the active pane, so switching conversations
  // unmounts ComposerFooter entirely — any component-local state would be wiped.
  // Sourcing them from the store makes the "Sending…" indicator and pasted
  // images follow their conversation and survive a switch away and back.
  const sending = useConversationSending(conversation.name);
  const pendingImages = useConversationImages(conversation.name);
  const setSendingFor = useComposerStore((s) => s.setSending);
  const enqueueImagesForConversation = useComposerStore((s) => s.enqueueImages);
  const removeImageForConversation = useComposerStore((s) => s.removeImage);
  const consumeImagesForConversation = useComposerStore((s) => s.consumeImages);

  const [text, setText] = useState('');
  const [isVoiceWidgetOpen, setIsVoiceWidgetOpen] = useState(false);
  const [voiceAutoStartToken, setVoiceAutoStartToken] = useState(0);
  const [voiceState, setVoiceState] = useState<{ isListening: boolean; error: string | null }>({ isListening: false, error: null });
  const editorRef = useRef<LexicalEditor | null>(null);
  const previousConversationNameRef = useRef(conversation.name);
  // Updated synchronously on every render so the in-flight-send guards below see
  // the currently-mounted conversation immediately (PAN-539 attribution race).
  const currentConversationNameRef = useRef(conversation.name);
  currentConversationNameRef.current = conversation.name;

  const piConversation = isPiConversation(conversation);
  const isDisabled = !conversation.sessionAlive || sending;
  const canEditModelBeforeStart = !agentId && !conversation.sessionAlive && !conversation.claudeSessionId;
  const isEmpty = text.trim() === '';

  // Images are pasted/dropped into the active composer, so conversation.name is
  // the owning conversation. The store stamps it onto each image for async
  // upload attribution.
  //
  // Guard: text-only models (e.g. mimo-v2.5-pro) return 404 on image input,
  // which the harness mistranslates as "model may not exist". Rather than block
  // the whole message, drop the image and pin a notice — the text still sends.
  // PAN-1685.
  const enqueueImages = useCallback((files: File[]) => {
    if (files.length > 0 && !modelSupportsImages(model)) {
      const def = findModelDef(model);
      toast.warning(
        `${def?.name ?? model} can't read images — image not attached. ` +
        `Switch to a vision-capable model (e.g. MiMo V2.5) to send images.`,
      );
      return;
    }
    enqueueImagesForConversation(conversation.name, files);
  }, [enqueueImagesForConversation, conversation.name, model]);

  const removePendingImage = useCallback((id: string) => {
    removeImageForConversation(conversation.name, id);
  }, [removeImageForConversation, conversation.name]);

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

  const handleEffortChange = useCallback((nextEffort: EffortLevel) => {
    const previousEffort = effort;
    setEffort(nextEffort);
    if (!piConversation || agentId || !conversation.sessionAlive) return;
    void (async () => {
      const res = await fetch(`/api/conversations/${encodeURIComponent(conversation.name)}/thinking-level`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: nextEffort }),
      });
      if (!res.ok) {
        setEffort(previousEffort);
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to set thinking level (${res.status})${body ? `: ${body}` : ''}`);
      }
    })().catch((err: unknown) => {
      console.error('[ComposerFooter] Failed to set thinking level:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to set thinking level');
    });
  }, [agentId, conversation.name, conversation.sessionAlive, effort, piConversation]);

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

    // Harvest images from the canonical surface first:
    //  - clipboardData.files: the FileList of files in this paste
    //  - clipboardData.items (kind:'file'): per-item access; only consulted when
    //    .files is empty (some Wayland Chromium screenshot-tool pastes).
    // We do NOT iterate both surfaces and dedupe — Chromium synthesizes
    // distinct File objects for each surface with their own `lastModified`
    // ticks, so a key built from (name,size,lastModified) can't reliably
    // recognize them as the same image and the user ends up with two copies
    // of the same screenshot intermittently.
    const collected: File[] = [];
    const addIfImage = (file: File | null) => {
      if (!file || !file.type.startsWith('image/')) return;
      collected.push(file);
    };
    const filesFromFiles = clipboardData.files ? Array.from(clipboardData.files) : [];
    if (filesFromFiles.length > 0) {
      for (const file of filesFromFiles) addIfImage(file);
    } else if (clipboardData.items) {
      for (const item of Array.from(clipboardData.items)) {
        if (item.kind === 'file') addIfImage(item.getAsFile());
      }
    }

    if (collected.length > 0) {
      event.preventDefault();
      enqueueImages(collected);
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
              enqueueImages(recovered);
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
  }, [enqueueImages, sending]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (sending || !conversation.sessionAlive) return;
    const imageFiles = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    enqueueImages(imageFiles);
  }, [enqueueImages, sending, conversation.sessionAlive]);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    const items = Array.from(event.dataTransfer.items);
    // Accept any file-kind drag (files don't expose their MIME type during dragover —
    // type is empty until drop on most browsers). Also accept anything declared as an image.
    if (items.some((item) => item.kind === 'file' || item.type.startsWith('image/'))) {
      event.preventDefault();
    }
  }, []);

  const handleSubmit = useCallback(async (directMessageText?: string) => {
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
      window.dispatchEvent(new CustomEvent('overdeck:open-fork-modal', {
        detail: { conversation, mode: 'handoff', focus },
      }));
      editor.update(() => {
        $getRoot().clear();
      });
      setText('');
      return;
    }

    const submitConversationName = conversation.name;

    // Re-read pending images before any async work — if uploads are still in
    // progress we must return early without switching model or sending. Read
    // this conversation's slice from the store (synchronous, unmount-proof).
    const currentPendingImages = getConversationImages(submitConversationName);
    const uploadingImages = currentPendingImages.filter((image) => !image.serverPath && !image.error);
    if (uploadingImages.length > 0) {
      toast.error('Please wait for image uploads to finish');
      return;
    }

    const failedImages = currentPendingImages.filter((image) => image.error);
    if (failedImages.length > 0) {
      toast.error('Remove failed image uploads before sending');
      return;
    }

    const uploadedImages = currentPendingImages.filter((image) => image.serverPath);
    if (!messageText && uploadedImages.length === 0) return;

    setSendingFor(submitConversationName, true);
    const imagePrefix = uploadedImages
      .map((image) => `@${image.serverPath}`)
      .join('\n');
    const composedMessage = [imagePrefix, messageText].filter(Boolean).join('\n');
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
      // pasted images in their owning conversation (they persist now) so they
      // survive for a retry when the user returns — do not revoke or delete.
      if (submitConversationName !== currentConversationNameRef.current) {
        return;
      }

      // Optimistic: notify parent immediately so message appears before server round-trip
      onSend?.(composedMessage);

      await sendConversationMessage(
        submitConversationName,
        composedMessage,
        agentId,
        piConversation ? deliverAs : undefined,
      );
      onSendAcknowledged?.(composedMessage);

      // The send consumed this conversation's images — revoke their previews and
      // drop them from the store. Target submitConversationName explicitly so the
      // right conversation is cleared even if the user switched while the send
      // was in flight. The sent message references the server uploads by @path,
      // so consumeImages does NOT delete them server-side.
      consumeImagesForConversation(submitConversationName);

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
      console.error('[ComposerFooter] Failed to send:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to send message');
      onSendFailed?.(composedMessage);
    } finally {
      // Clear the originating conversation's sending state regardless of which
      // conversation is now mounted — the send belonged to submitConversationName.
      setSendingFor(submitConversationName, false);
      // Refocus editor
      editor.focus();
    }
  }, [agentId, conversation.model, conversation.name, conversation.sessionAlive, consumeImagesForConversation, deliverAs, harness, isDisabled, model, onSend, onSendAcknowledged, onSendFailed, piConversation, sending, setSendingFor]);

  useEffect(() => {
    const previousConversationName = previousConversationNameRef.current;
    if (previousConversationName === conversation.name) {
      return;
    }

    previousConversationNameRef.current = conversation.name;
    // Do NOT touch pending images or sending here. Both live in the
    // composerStore keyed per-conversation, so a screenshot pasted into one
    // conversation — or a send still in flight — survives navigating away and
    // back. In-flight uploads attach to their owning conversation; the send's
    // own finally clears its sending flag by submitConversationName.
    setModel(conversation.model ?? getDefaultConversationModel());
    setHarness((conversation.harness === 'pi' ? 'ohmypi' : conversation.harness) ?? 'claude-code');
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

  const handleCommandKey = useCallback(
    (key: 'Enter') => {
      if (key === 'Enter') void handleSubmit();
    },
    [handleSubmit],
  );

  return (
    <div className={styles.composerFooter}>
      {/* Single unified container — T3Chat style */}
      <div className={styles.composerBox} onDrop={handleDrop} onDragOver={handleDragOver}>
        {pendingImages.length > 0 && (
          <div className={styles.composerImageStrip}>
            {pendingImages.map((image) => {
              const isUploading = !image.serverPath && !image.error;
              const statusLabel = image.error
                ? image.error
                : image.serverPath
                  ? 'Uploaded'
                  : 'Uploading…';
              return (
                <div key={image.id} className={styles.composerImageCard}>
                  <img src={image.previewUrl} alt={image.file.name} className={styles.composerImageThumb} />
                  <div className={styles.composerImageMeta}>
                    <span className={styles.composerImageName}>{image.file.name}</span>
                    <span className={image.error ? styles.composerImageError : styles.composerImageStatus}>
                      {isUploading ? <Loader2 size={12} className={styles.spinner} /> : null}
                      {statusLabel}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.composerImageRemoveButton}
                    onClick={() => removePendingImage(image.id)}
                    title={`Remove ${image.file.name}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Editor (no border of its own) */}
        <ComposerPromptEditor
          conversationName={conversation.name}
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
          <EffortPicker value={effort} onChange={handleEffortChange} disabled={!conversation.sessionAlive} availableLevels={MODEL_EFFORT_SUPPORT[model as keyof typeof MODEL_EFFORT_SUPPORT]} />

          {piConversation && !agentId && (
            <>
              <select
                className={styles.deliveryMethodSelect}
                value={deliverAs}
                onChange={(event) => setDeliverAs(event.target.value as DeliverAs)}
                title={agentBusy ? 'Pi delivery mode while busy' : 'Pi delivery mode'}
                aria-label="Pi delivery mode"
                disabled={!conversation.sessionAlive}
              >
                <option value="steer">Steer</option>
                <option value="follow_up">Follow-up</option>
              </select>
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
            disabled={(isEmpty && pendingImages.filter((image) => !!image.serverPath).length === 0) || isDisabled}
            type="button"
            title="Send message (Enter)"
          >
            <SendHorizontal size={16} />
          </button>
        </div>
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
