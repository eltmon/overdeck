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

import { useState, useRef, useCallback } from 'react';
import { SendHorizontal } from 'lucide-react';
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

interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
  serverPath: string | null;
  error: string | null;
}

async function uploadConversationImage(
  conversationName: string,
  file: File,
): Promise<string> {
  const bytes = await file.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
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

  const isDisabled = !conversation.sessionAlive || sending;
  const isEmpty = text.trim() === '';

  const updatePendingImage = useCallback((id: string, updates: Partial<PendingImage>) => {
    setPendingImages((images) => images.map((image) => (image.id === id ? { ...image, ...updates } : image)));
  }, []);

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

    setPendingImages((images) => [...images, ...newImages]);

    for (const image of newImages) {
      void uploadConversationImage(conversation.name, image.file)
        .then((serverPath) => {
          updatePendingImage(image.id, { serverPath, error: null });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Failed to upload image';
          updatePendingImage(image.id, { error: message });
        });
    }
  }, [conversation.name, updatePendingImage]);

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
    const items = Array.from(event.clipboardData.items);
    const imageFiles = items
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (imageFiles.length === 0) return;
    event.preventDefault();
    enqueueImages(imageFiles);
  }, [enqueueImages]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    const imageFiles = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    event.preventDefault();
    enqueueImages(imageFiles);
  }, [enqueueImages]);

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

    if (!messageText) return;

    // Optimistic: notify parent immediately so message appears before server round-trip
    onSend?.(messageText);

    setSending(true);
    try {
      // If the selected model differs from the conversation's current model,
      // kill the session and restart with the new model before sending.
      if (model !== conversation.model && conversation.sessionAlive) {
        await switchModel(conversation.name, model);
        // Wait for the new session to spawn before sending the message
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      await sendConversationMessage(conversation.name, messageText);

      // Clear editor after successful send
      editor.update(() => {
        $getRoot().clear();
      });
      setText('');
    } catch (err) {
      console.error('[ComposerFooter] Failed to send:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
      // Refocus editor
      editor.focus();
    }
  }, [model, conversation.name, conversation.model, conversation.sessionAlive, sending, isDisabled, onSend]);

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
            disabled={isEmpty || isDisabled}
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
