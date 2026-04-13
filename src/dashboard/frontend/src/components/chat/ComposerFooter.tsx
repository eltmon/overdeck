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
  const editorRef = useRef<LexicalEditor | null>(null);

  const isDisabled = !conversation.sessionAlive || sending;
  const isEmpty = text.trim() === '';

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
      <div className={styles.composerBox}>
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
