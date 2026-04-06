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
import type { LexicalEditor } from 'lexical';
import { $getRoot } from 'lexical';
import { ComposerPromptEditor } from './ComposerPromptEditor';
import { ModelPicker, loadStoredModel, MODEL_EFFORT_SUPPORT, type ClaudeModelId } from './ModelPicker';
import { EffortPicker, loadStoredEffort, type EffortLevel } from './EffortPicker';
import type { Conversation } from '../MissionControl/ConversationList';
import styles from '../MissionControl/styles/mission-control.module.css';

// ─── API ──────────────────────────────────────────────────────────────────────

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
  if (!res.ok) throw new Error('Failed to send message');
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ComposerFooterProps {
  conversation: Conversation;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ComposerFooter({ conversation }: ComposerFooterProps) {
  const [model, setModel] = useState<ClaudeModelId>(loadStoredModel);
  const [effort, setEffort] = useState<EffortLevel>(loadStoredEffort);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const editorRef = useRef<LexicalEditor | null>(null);

  const isDisabled = !conversation.sessionAlive || sending;
  const isEmpty = text.trim() === '';

  // Send /model command to tmux when model is changed on an active conversation
  const handleModelChange = useCallback((newModel: ClaudeModelId) => {
    setModel(newModel);
    if (conversation.sessionAlive) {
      void sendConversationMessage(conversation.name, `/model ${newModel}`).catch((err: unknown) => {
        console.error('[ComposerFooter] Failed to send /model:', err);
      });
    }
  }, [conversation.name, conversation.sessionAlive]);

  const handleSubmit = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || isEmpty || isDisabled) return;

    // Read text from Lexical state
    let messageText = '';
    editor.read(() => {
      messageText = $getRoot().getTextContent().trim();
    });

    if (!messageText) return;

    setSending(true);
    try {
      await sendConversationMessage(conversation.name, messageText);

      // Clear editor after successful send
      editor.update(() => {
        $getRoot().clear();
      });
      setText('');
    } catch (err) {
      console.error('[ComposerFooter] Failed to send:', err);
    } finally {
      setSending(false);
      // Refocus editor
      editor.focus();
    }
  }, [conversation.name, isEmpty, isDisabled]);

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
          <EffortPicker value={effort} onChange={setEffort} disabled={true} availableLevels={MODEL_EFFORT_SUPPORT[model]} />

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
