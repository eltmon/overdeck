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
import { useQueryClient } from '@tanstack/react-query';
import { SendHorizontal } from 'lucide-react';
import type { LexicalEditor } from 'lexical';
import { $getRoot } from 'lexical';
import { ComposerPromptEditor } from './ComposerPromptEditor';
import { ModelPicker, loadStoredModel, type ClaudeModelId } from './ModelPicker';
import { EffortPicker, loadStoredEffort, type EffortLevel } from './EffortPicker';
import type { Conversation } from '../MissionControl/ConversationList';
import styles from '../MissionControl/styles/mission-control.module.css';

// ─── API ──────────────────────────────────────────────────────────────────────

async function updateConversationTitle(name: string, title: string): Promise<void> {
  await fetch(`/api/conversations/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
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
  if (!res.ok) throw new Error('Failed to send message');
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ComposerFooterProps {
  conversation: Conversation;
  /** True when no messages have been sent yet — first send sets the conversation title. */
  isFirstMessage?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ComposerFooter({ conversation, isFirstMessage }: ComposerFooterProps) {
  const [model, setModel] = useState<ClaudeModelId>(loadStoredModel);
  const [effort, setEffort] = useState<EffortLevel>(loadStoredEffort);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const editorRef = useRef<LexicalEditor | null>(null);
  const queryClient = useQueryClient();

  const isDisabled = !conversation.sessionAlive || sending;
  const isEmpty = text.trim() === '';

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

      // Auto-title from first message: truncate to 60 chars
      if (isFirstMessage && !conversation.title) {
        const title = messageText.slice(0, 60) + (messageText.length > 60 ? '…' : '');
        void updateConversationTitle(conversation.name, title).then(() => {
          void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        });
      }

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
  }, [conversation.name, conversation.title, isFirstMessage, isEmpty, isDisabled, queryClient]);

  const handleCommandKey = useCallback(
    (key: 'Enter') => {
      if (key === 'Enter') void handleSubmit();
    },
    [handleSubmit],
  );

  return (
    <div className={styles.composerFooter}>
      {/* Editor */}
      <ComposerPromptEditor
        conversationName={conversation.name}
        disabled={isDisabled}
        onCommandKeyDown={handleCommandKey}
        editorRef={editorRef}
        onChange={setText}
      />

      {/* Toolbar */}
      <div className={styles.composerToolbar}>
        <ModelPicker value={model} onChange={setModel} disabled={isDisabled} />
        <EffortPicker value={effort} onChange={setEffort} disabled={isDisabled} />

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
  );
}
