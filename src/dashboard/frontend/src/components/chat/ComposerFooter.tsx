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
import { AlertCircle, Mic, MicOff, SendHorizontal, X, Loader2 } from 'lucide-react';
import type { ClipboardEvent, DragEvent } from 'react';
import { toast } from 'sonner';
import type { LexicalEditor } from 'lexical';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { ComposerPromptEditor, loadDraft } from './ComposerPromptEditor';
import { VoiceWidget } from './VoiceWidget';
import { ModelPicker, MODEL_EFFORT_SUPPORT, saveStoredHarness, saveStoredModel } from './ModelPicker';
import type { Harness } from '../shared/ModelPicker';
import { getDefaultConversationModel } from './defaultConversationModel';
import { EffortPicker, loadStoredEffort, type EffortLevel } from './EffortPicker';
import { ContextWindowMeter } from './ContextWindowMeter';
import type { ContextWindowSnapshot } from '../../lib/contextWindow';
import type { Conversation } from '../CommandDeck/ConversationList';
import styles from '../CommandDeck/styles/command-deck.module.css';

// ─── API ──────────────────────────────────────────────────────────────────────

async function switchModel(
  conversationName: string,
  model: string,
  agentId?: string,
  harness?: Harness,
): Promise<void> {
  const endpoint = agentId
    ? `/api/agents/${encodeURIComponent(agentId)}/switch-model`
    : `/api/conversations/${encodeURIComponent(conversationName)}/switch-model`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, harness }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to switch model (${res.status})${body ? `: ${body}` : ''}`);
  }
}

async function sendConversationMessage(
  conversationName: string,
  message: string,
  agentId?: string,
): Promise<void> {
  const endpoint = agentId
    ? `/api/agents/${encodeURIComponent(agentId)}/message`
    : `/api/conversations/${encodeURIComponent(conversationName)}/message`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to send message (${res.status})${body ? `: ${body}` : ''}`);
  }
}

async function deleteConversationImage(
  conversationName: string,
  path: string,
): Promise<void> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationName)}/delete-image`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to delete image (${res.status})${body ? `: ${body}` : ''}`);
  }
}

interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
  serverPath: string | null;
  error: string | null;
}

function revokePreviewUrl(previewUrl: string): void {
  if (typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(previewUrl);
  }
}

async function uploadConversationImage(
  conversationName: string,
  file: File,
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('filename', file.name);
  formData.append('mimeType', file.type);

  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationName)}/upload-image`,
    {
      method: 'POST',
      body: formData,
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to upload image (${res.status})${body ? `: ${body}` : ''}`);
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new Error('Image upload response was not valid JSON');
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('path' in payload) ||
    typeof payload.path !== 'string' ||
    payload.path.length === 0
  ) {
    throw new Error('Image upload response did not include a path');
  }
  return payload.path;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ComposerFooterProps {
  conversation: Conversation;
  /** Called with the message text the instant it is sent — use for optimistic display */
  onSend?: (text: string) => void;
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
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ComposerFooter({
  conversation,
  onSend,
  onSendFailed,
  agentId,
  contextWindowUsage = null,
}: ComposerFooterProps) {
  const [model, setModel] = useState<string>(conversation.model ?? getDefaultConversationModel());
  // Existing conversations are bound to the harness they were spawned with.
  // Falling back to a global localStorage default here caused the picker to
  // display the *last globally-picked* harness for any conversation whose
  // harness column was null, then send that harness on the next /switch-model
  // call — silently rewriting the conversation's runtime. Default to
  // 'claude-code' (the safe runtime) when the conversation has no stored
  // harness; do NOT consult localStorage.
  const [harness, setHarness] = useState<Harness>(conversation.harness ?? 'claude-code');
  const [effort, setEffort] = useState<EffortLevel>(loadStoredEffort);
  // `sending` is scoped per-conversation, not a single boolean. ComposerFooter
  // is reused (not React-keyed) across conversation switches, so a plain
  // `useState(false)` leaked the "Sending…" state into whichever conversation
  // was mounted next, and an in-flight send that resolved after a switch would
  // clear the wrong conversation. Keying by conversation.name — the same scheme
  // drafts use — makes the indicator follow the conversation it belongs to.
  // Entries are deleted (not set false) when a send settles so the map only
  // ever holds conversations with a send genuinely in flight.
  const [sendingByConversation, setSendingByConversation] = useState<Record<string, boolean>>({});
  const setSendingFor = useCallback((conversationName: string, value: boolean) => {
    setSendingByConversation((prev) => {
      if (value) {
        if (prev[conversationName]) return prev;
        return { ...prev, [conversationName]: true };
      }
      if (!prev[conversationName]) return prev;
      const next = { ...prev };
      delete next[conversationName];
      return next;
    });
  }, []);
  const sending = sendingByConversation[conversation.name] ?? false;
  const [text, setText] = useState('');
  const [isVoiceWidgetOpen, setIsVoiceWidgetOpen] = useState(false);
  const [voiceState, setVoiceState] = useState<{ isListening: boolean; error: string | null }>({ isListening: false, error: null });
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const editorRef = useRef<LexicalEditor | null>(null);
  const pendingImagesRef = useRef<PendingImage[]>([]);
  const removedImageIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const previousConversationNameRef = useRef(conversation.name);
  // Updated synchronously on every render so upload callbacks see the current
  // conversation immediately — not after the useEffect fires. This prevents
  // a race where an upload that completes during a conversation switch gets
  // attached to the wrong conversation (PAN-539 blocker).
  const currentConversationNameRef = useRef(conversation.name);
  currentConversationNameRef.current = conversation.name;
  const uploadQueueRef = useRef<PendingImage[]>([]);
  const activeUploadsRef = useRef(0);
  const MAX_CONCURRENT_UPLOADS = 3;

  const isDisabled = !conversation.sessionAlive || sending;
  const isEmpty = text.trim() === '';

  const deleteUploadedImage = useCallback((conversationName: string, path: string) => {
    void deleteConversationImage(conversationName, path).catch((err: unknown) => {
      console.error('[ComposerFooter] Failed to delete image:', err);
    });
  }, []);

  const updatePendingImage = useCallback((id: string, updates: Partial<PendingImage>) => {
    setPendingImages((images) => {
      const next = images.map((image) => (image.id === id ? { ...image, ...updates } : image));
      pendingImagesRef.current = next;
      return next;
    });
  }, []);

  const removePendingImage = useCallback((id: string) => {
    removedImageIdsRef.current.add(id);
    const image = pendingImagesRef.current.find((candidate) => candidate.id === id);
    if (image) {
      revokePreviewUrl(image.previewUrl);
      if (image.serverPath) {
        // Use the synchronous ref to avoid deleting from the wrong
        // conversation if a switch happened between render and click.
        deleteUploadedImage(currentConversationNameRef.current, image.serverPath);
      }
    }
    setPendingImages((images) => {
      const next = images.filter((candidate) => candidate.id !== id);
      pendingImagesRef.current = next;
      return next;
    });
  }, [deleteUploadedImage]);

  const processUploadQueue = useCallback(() => {
    while (
      activeUploadsRef.current < MAX_CONCURRENT_UPLOADS &&
      uploadQueueRef.current.length > 0
    ) {
      const image = uploadQueueRef.current.shift()!;
      activeUploadsRef.current++;
      // Capture the ref synchronously at upload start so the callback
      // always targets the conversation that was active when the upload
      // began, avoiding stale-closure races on rapid conversation switches.
      const ownerConversationName = currentConversationNameRef.current;
      void uploadConversationImage(ownerConversationName, image.file).then(
        (serverPath) => {
          activeUploadsRef.current--;
          try {
            // Use the synchronously-updated ref so we detect conversation
            // switches immediately, not after the useEffect fires.
            if (
              removedImageIdsRef.current.has(image.id)
              || !mountedRef.current
              || ownerConversationName !== currentConversationNameRef.current
            ) {
              deleteUploadedImage(ownerConversationName, serverPath);
            } else {
              updatePendingImage(image.id, { serverPath, error: null });
            }
          } finally {
            processUploadQueue();
          }
        },
        (err: unknown) => {
          activeUploadsRef.current--;
          try {
            if (removedImageIdsRef.current.has(image.id) || !mountedRef.current) {
              return;
            }
            const message = err instanceof Error ? err.message : 'Failed to upload image';
            updatePendingImage(image.id, { error: message });
          } finally {
            processUploadQueue();
          }
        },
      );
    }
  }, [deleteUploadedImage, updatePendingImage]);

  const enqueueImages = useCallback((files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const newImages = imageFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      serverPath: null,
      error: null,
    } satisfies PendingImage));

    setPendingImages((images) => {
      const next = [...images, ...newImages];
      pendingImagesRef.current = next;
      return next;
    });

    uploadQueueRef.current.push(...newImages);
    processUploadQueue();
  }, [processUploadQueue]);

  // Changing harness is a runtime switch — the new harness wraps a different
  // binary (claude vs pi). Just updating local state would diverge the UI from
  // the running tmux session. Reuse switch-model (which already accepts harness
  // and handles kill+respawn) so the conversation is truly rebound. Persist to
  // the global localStorage default *only* — the per-conversation harness is
  // now owned by the backend.
  const handleHarnessChange = useCallback((newHarness: Harness) => {
    if (newHarness === harness) return;
    setHarness(newHarness);
    saveStoredHarness(newHarness);
    if (conversation.sessionAlive) {
      const switchConversationName = conversation.name;
      setSendingFor(switchConversationName, true);
      void switchModel(switchConversationName, model, agentId, newHarness)
        .catch((err: unknown) => {
          console.error('[ComposerFooter] Failed to switch harness:', err);
          toast.error(err instanceof Error ? err.message : 'Failed to switch harness');
          // Roll back the optimistic state change so the UI matches the server.
          setHarness(harness);
        })
        .finally(() => {
          setSendingFor(switchConversationName, false);
        });
    }
  }, [agentId, conversation.name, conversation.sessionAlive, harness, model, setSendingFor]);

  const handleModelChange = useCallback((newModel: string, _effortLevels: readonly string[]) => {
    setModel(newModel);
    saveStoredModel(newModel);
    if (conversation.sessionAlive) {
      const switchConversationName = conversation.name;
      setSendingFor(switchConversationName, true);
      void switchModel(switchConversationName, newModel, agentId, harness)
        .catch((err: unknown) => {
          console.error('[ComposerFooter] Failed to switch model:', err);
          toast.error(err instanceof Error ? err.message : 'Failed to switch model');
        })
        .finally(() => {
          setSendingFor(switchConversationName, false);
        });
    }
  }, [agentId, conversation.name, conversation.sessionAlive, harness, setSendingFor]);

  /**
   * Atomic model+harness swap. Used by the picker's auto-resolve flow when
   * a single click would otherwise fire two switch-model API calls that race
   * on the tmux session lifecycle (PAN-1067).
   */
  const handleComboChange = useCallback((newModel: string, _effortLevels: readonly string[], newHarness: Harness) => {
    setModel(newModel);
    saveStoredModel(newModel);
    setHarness(newHarness);
    saveStoredHarness(newHarness);
    if (conversation.sessionAlive) {
      const switchConversationName = conversation.name;
      setSendingFor(switchConversationName, true);
      void switchModel(switchConversationName, newModel, agentId, newHarness)
        .catch((err: unknown) => {
          console.error('[ComposerFooter] Failed to switch model+harness:', err);
          toast.error(err instanceof Error ? err.message : 'Failed to switch model+harness');
          // Roll back to keep UI in sync with backend on failure.
          setModel(model);
          setHarness(harness);
        })
        .finally(() => {
          setSendingFor(switchConversationName, false);
        });
    }
  }, [agentId, conversation.name, conversation.sessionAlive, harness, model, setSendingFor]);

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
      window.dispatchEvent(new CustomEvent('panopticon:open-fork-modal', {
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
    // progress we must return early without switching model or sending.
    const currentPendingImages = pendingImagesRef.current;
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
      // If the selected model differs from the conversation's current model,
      // kill the session and restart with the new model before sending.
      // switchModel already waits for the new session to be ready before returning.
      if (model !== conversation.model && conversation.sessionAlive) {
        await switchModel(submitConversationName, model, agentId, harness);
      }

      // Abort if conversation switched during the async model switch — the
      // switch useEffect will have already cleared pending images and deleted
      // uploads for the old conversation.
      if (submitConversationName !== currentConversationNameRef.current) {
        for (const image of currentPendingImages) {
          revokePreviewUrl(image.previewUrl);
        }
        return;
      }

      // Optimistic: notify parent immediately so message appears before server round-trip
      onSend?.(composedMessage);

      await sendConversationMessage(submitConversationName, composedMessage, agentId);

      // Only clear state if conversation is still the same (avoid clearing the
      // new conversation's composer if user switched while send was in flight)
      if (submitConversationName === currentConversationNameRef.current) {
        editor.update(() => {
          $getRoot().clear();
        });
        setText('');
        for (const image of currentPendingImages) {
          revokePreviewUrl(image.previewUrl);
        }
        pendingImagesRef.current = [];
        // Do NOT clear removedImageIdsRef here — in-flight upload callbacks
        // still need it to decide whether to delete orphaned server uploads.
        setPendingImages([]);
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
  }, [agentId, conversation.model, conversation.name, conversation.sessionAlive, harness, isDisabled, model, onSend, onSendFailed, sending, setSendingFor]);

  useEffect(() => {
    const previousConversationName = previousConversationNameRef.current;
    if (previousConversationName === conversation.name) {
      return;
    }

    previousConversationNameRef.current = conversation.name;
    const images = pendingImagesRef.current;
    pendingImagesRef.current = [];
    uploadQueueRef.current = [];
    removedImageIdsRef.current.clear();
    for (const image of images) {
      revokePreviewUrl(image.previewUrl);
      if (image.serverPath) {
        deleteUploadedImage(previousConversationName, image.serverPath);
      }
    }

    setPendingImages([]);
    // Do NOT reset sending here. It is now keyed per-conversation, so a send
    // in flight for the conversation you're switching back to must keep showing
    // "Sending…". The send's own finally clears it by submitConversationName.
    setModel(conversation.model ?? getDefaultConversationModel());
    setHarness(conversation.harness ?? 'claude-code');
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
  }, [conversation.name, conversation.model, deleteUploadedImage]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const images = pendingImagesRef.current;
      const conversationName = previousConversationNameRef.current;
      pendingImagesRef.current = [];
      removedImageIdsRef.current.clear();
      for (const image of images) {
        revokePreviewUrl(image.previewUrl);
        if (image.serverPath) {
          deleteUploadedImage(conversationName, image.serverPath);
        }
      }
    };
  }, [deleteUploadedImage]);

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
            disabled={isDisabled}
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
          <EffortPicker value={effort} onChange={setEffort} disabled={isDisabled} availableLevels={MODEL_EFFORT_SUPPORT[model as keyof typeof MODEL_EFFORT_SUPPORT]} />

          <div className={styles.composerToolbarSpacer} />

          <button
            className={isVoiceWidgetOpen ? styles.voiceToolbarButtonActive : styles.voiceToolbarButton}
            onClick={() => setIsVoiceWidgetOpen((open) => !open)}
            disabled={isDisabled}
            type="button"
            title={voiceState.error ? `Voice error: ${voiceState.error}` : voiceState.isListening ? 'Voice input listening' : 'Toggle voice input'}
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
          />
        )}
      </div>
    </div>
  );
}
