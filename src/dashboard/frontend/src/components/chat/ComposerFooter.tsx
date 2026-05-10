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
import { SendHorizontal, X, Loader2 } from 'lucide-react';
import type { ClipboardEvent, DragEvent } from 'react';
import { toast } from 'sonner';
import type { LexicalEditor } from 'lexical';
import { $getRoot } from 'lexical';
import { ComposerPromptEditor } from './ComposerPromptEditor';
import { ModelPicker, MODEL_EFFORT_SUPPORT, loadStoredHarness, saveStoredHarness, saveStoredModel } from './ModelPicker';
import type { Harness } from '../shared/ModelPicker';
import { getDefaultConversationModel } from './defaultConversationModel';
import { EffortPicker, loadStoredEffort, type EffortLevel } from './EffortPicker';
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
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ComposerFooter({ conversation, onSend, onSendFailed, agentId }: ComposerFooterProps) {
  const [model, setModel] = useState<string>(conversation.model ?? getDefaultConversationModel());
  const [harness, setHarness] = useState<Harness>(conversation.harness ?? loadStoredHarness());
  const [effort, setEffort] = useState<EffortLevel>(loadStoredEffort);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
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

  // Switch model via API — kills session and respawns with correct provider env.
  // Unlike /model (same-provider only), this works for cross-provider switches.
  const handleHarnessChange = useCallback((newHarness: Harness) => {
    setHarness(newHarness);
    saveStoredHarness(newHarness);
  }, []);

  const handleModelChange = useCallback((newModel: string, _effortLevels: readonly string[]) => {
    setModel(newModel);
    saveStoredModel(newModel);
    if (conversation.sessionAlive) {
      setSending(true);
      void switchModel(conversation.name, newModel, agentId, harness)
        .catch((err: unknown) => {
          console.error('[ComposerFooter] Failed to switch model:', err);
          toast.error(err instanceof Error ? err.message : 'Failed to switch model');
        })
        .finally(() => {
          setSending(false);
        });
    }
  }, [agentId, conversation.name, conversation.sessionAlive, harness]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (sending) {
      event.preventDefault();
      return;
    }
    if (!event.clipboardData) return;
    const items = Array.from(event.clipboardData.items);
    const imageFiles = items
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (imageFiles.length === 0) return;
    event.preventDefault();
    enqueueImages(imageFiles);
  }, [enqueueImages, sending]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (sending || !conversation.sessionAlive) return;
    const imageFiles = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    enqueueImages(imageFiles);
  }, [enqueueImages, sending, conversation.sessionAlive]);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (Array.from(event.dataTransfer.items).some((item) => item.type.startsWith('image/'))) {
      event.preventDefault();
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) {
      console.warn('[ComposerFooter] handleSubmit: editor ref not ready');
      return;
    }
    if (isDisabled) {
      console.warn('[ComposerFooter] handleSubmit: isDisabled=true, sessionAlive=%s sending=%s', conversation.sessionAlive, sending);
      return;
    }

    // Read text directly from Lexical — don't trust React state which may be stale
    let messageText = '';
    editor.read(() => {
      messageText = $getRoot().getTextContent().trim();
    });

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

    setSending(true);
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
      setSending(false);
      // Refocus editor
      editor.focus();
    }
  }, [model, conversation.name, conversation.model, conversation.sessionAlive, sending, isDisabled, onSend, onSendFailed]);

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
    setText('');
    setSending(false);
    setModel(conversation.model ?? getDefaultConversationModel());
    setHarness(conversation.harness ?? loadStoredHarness());
    editorRef.current?.update(() => {
      $getRoot().clear();
    });
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
          <ModelPicker value={model} onChange={handleModelChange} disabled={isDisabled} harness={harness} onHarnessChange={handleHarnessChange} />
          <div className={styles.composerToolbarDivider} />
          <EffortPicker value={effort} onChange={setEffort} disabled={isDisabled} availableLevels={MODEL_EFFORT_SUPPORT[model as keyof typeof MODEL_EFFORT_SUPPORT]} />

          <div className={styles.composerToolbarSpacer} />

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
      </div>
    </div>
  );
}
