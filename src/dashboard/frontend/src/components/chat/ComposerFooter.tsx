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
import { SendHorizontal, X } from 'lucide-react';
import type { ClipboardEvent, DragEvent } from 'react';
import { toast } from 'sonner';
import type { LexicalEditor } from 'lexical';
import { $getRoot } from 'lexical';
import { ComposerPromptEditor } from './ComposerPromptEditor';
import { ModelPicker, MODEL_EFFORT_SUPPORT, saveStoredModel } from './ModelPicker';
import { getDefaultConversationModel } from './defaultConversationModel';
import { EffortPicker, loadStoredEffort, type EffortLevel } from './EffortPicker';
import type { Conversation } from '../MissionControl/ConversationList';
import styles from '../MissionControl/styles/mission-control.module.css';

// ─── API ──────────────────────────────────────────────────────────────────────

async function switchModel(
  conversationName: string,
  model: string,
): Promise<void> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationName)}/switch-model`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to switch model (${res.status})${body ? `: ${body}` : ''}`);
  }
}

async function sendConversationMessage(
  conversationName: string,
  message: string,
): Promise<void> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationName)}/message`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    },
  );
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

function encodeImageBytes(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function uploadConversationImage(
  conversationName: string,
  file: File,
): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = encodeImageBytes(bytes);
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationName)}/upload-image`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        data: base64,
        mimeType: file.type,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to upload image (${res.status})${body ? `: ${body}` : ''}`);
  }
  const payload = await res.json() as { path?: unknown };
  if (typeof payload.path !== 'string' || payload.path.length === 0) {
    throw new Error('Image upload response did not include a path');
  }
  return payload.path;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ComposerFooterProps {
  conversation: Conversation;
  /** Called with the message text the instant it is sent — use for optimistic display */
  onSend?: (text: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ComposerFooter({ conversation, onSend }: ComposerFooterProps) {
  const [model, setModel] = useState<string>(conversation.model ?? getDefaultConversationModel());
  const [effort, setEffort] = useState<EffortLevel>(loadStoredEffort);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const editorRef = useRef<LexicalEditor | null>(null);
  const pendingImagesRef = useRef<PendingImage[]>([]);
  const removedImageIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const previousConversationNameRef = useRef(conversation.name);

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

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  const removePendingImage = useCallback((id: string) => {
    removedImageIdsRef.current.add(id);
    const image = pendingImagesRef.current.find((candidate) => candidate.id === id);
    if (image) {
      revokePreviewUrl(image.previewUrl);
      if (image.serverPath) {
        deleteUploadedImage(conversation.name, image.serverPath);
      }
    }
    setPendingImages((images) => {
      const next = images.filter((candidate) => candidate.id !== id);
      pendingImagesRef.current = next;
      return next;
    });
  }, [conversation.name, deleteUploadedImage]);

  const enqueueImages = useCallback((files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const ownerConversationName = conversation.name;
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

    for (const image of newImages) {
      void uploadConversationImage(ownerConversationName, image.file)
        .then((serverPath) => {
          if (
            removedImageIdsRef.current.has(image.id)
            || !mountedRef.current
            || ownerConversationName !== previousConversationNameRef.current
          ) {
            deleteUploadedImage(ownerConversationName, serverPath);
            return;
          }
          updatePendingImage(image.id, { serverPath, error: null });
        })
        .catch((err: unknown) => {
          if (removedImageIdsRef.current.has(image.id) || !mountedRef.current) {
            return;
          }
          const message = err instanceof Error ? err.message : 'Failed to upload image';
          updatePendingImage(image.id, { error: message });
        });
    }
  }, [conversation.name, deleteUploadedImage, updatePendingImage]);

  // Send /model command to tmux when model is changed on an active conversation
  const handleModelChange = useCallback((newModel: string, _effortLevels: readonly string[]) => {
    setModel(newModel);
    saveStoredModel(newModel);
    if (conversation.sessionAlive) {
      void sendConversationMessage(conversation.name, `/model ${newModel}`).catch((err: unknown) => {
        console.error('[ComposerFooter] Failed to send /model:', err);
      });
    }
  }, [conversation.name, conversation.sessionAlive]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (sending) {
      event.preventDefault();
      return;
    }
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
    if (sending) {
      event.preventDefault();
      return;
    }
    const imageFiles = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    event.preventDefault();
    enqueueImages(imageFiles);
  }, [enqueueImages, sending]);

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

    const uploadingImages = pendingImages.filter((image) => !image.serverPath && !image.error);
    if (uploadingImages.length > 0) {
      toast.error('Please wait for image uploads to finish');
      return;
    }

    const failedImages = pendingImages.filter((image) => image.error);
    if (failedImages.length > 0) {
      toast.error('Remove failed image uploads before sending');
      return;
    }

    const uploadedImages = pendingImages.filter((image) => image.serverPath);
    if (!messageText && uploadedImages.length === 0) return;

    const imagePrefix = uploadedImages
      .map((image) => `@${image.serverPath}`)
      .join('\n');
    const composedMessage = [imagePrefix, messageText].filter(Boolean).join('\n');

    // Optimistic: notify parent immediately so message appears before server round-trip
    onSend?.(composedMessage);

    setSending(true);
    try {
      // If the selected model differs from the conversation's current model,
      // kill the session and restart with the new model before sending.
      // switchModel already waits for the new session to be ready before returning.
      if (model !== conversation.model && conversation.sessionAlive) {
        await switchModel(conversation.name, model);
      }

      await sendConversationMessage(conversation.name, composedMessage);

      // Clear editor after successful send
      editor.update(() => {
        $getRoot().clear();
      });
      setText('');
      for (const image of pendingImages) {
        revokePreviewUrl(image.previewUrl);
      }
      pendingImagesRef.current = [];
      removedImageIdsRef.current.clear();
      setPendingImages([]);
    } catch (err) {
      console.error('[ComposerFooter] Failed to send:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
      // Refocus editor
      editor.focus();
    }
  }, [model, conversation.name, conversation.model, conversation.sessionAlive, sending, isDisabled, onSend, pendingImages]);

  useEffect(() => {
    const previousConversationName = previousConversationNameRef.current;
    if (previousConversationName === conversation.name) {
      return;
    }

    previousConversationNameRef.current = conversation.name;
    const images = pendingImagesRef.current;
    pendingImagesRef.current = [];
    for (const image of images) {
      removedImageIdsRef.current.add(image.id);
      revokePreviewUrl(image.previewUrl);
      if (image.serverPath) {
        deleteUploadedImage(previousConversationName, image.serverPath);
      }
    }

    setPendingImages([]);
    setText('');
    setSending(false);
    setModel(conversation.model ?? getDefaultConversationModel());
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
      for (const image of images) {
        removedImageIdsRef.current.add(image.id);
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
      <div className={styles.composerBox} onPaste={handlePaste} onDrop={handleDrop} onDragOver={handleDragOver}>
        {pendingImages.length > 0 && (
          <div className={styles.composerImageStrip}>
            {pendingImages.map((image) => {
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
        />

        {/* Toolbar inside the box */}
        <div className={styles.composerToolbar}>
          <ModelPicker value={model} onChange={handleModelChange} disabled={isDisabled} />
          <div className={styles.composerToolbarDivider} />
          <EffortPicker value={effort} onChange={setEffort} disabled={true} availableLevels={MODEL_EFFORT_SUPPORT[model as keyof typeof MODEL_EFFORT_SUPPORT]} />

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
