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
  const [text, setText] = useState('');
  const editorRef = useRef<LexicalEditor | null>(null);
  // Tracks an in-flight server-side model switch so rapid-fire sends don't
  // trigger multiple concurrent switches. The message queue (outbox) owns delivery
  // and is independent of switch state — a send is never blocked by in-flight work.
  const switchingRef = useRef<Promise<void> | null>(null);

  // Editor is only disabled if the underlying session is dead. We never
  // block on "sending" — the outbox accepts messages durably, so rapid Enter
  // presses must ALWAYS be captured into the outbox, never silently dropped.
  const isDisabled = !conversation.sessionAlive;
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

  const handleSubmit = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      console.warn('[ComposerFooter] handleSubmit: editor ref not ready');
      return;
    }
    if (!conversation.sessionAlive) {
      toast.error('Conversation session is not active — cannot send.');
      return;
    }

    // Read text directly from Lexical — don't trust React state which may be stale
    let messageText = '';
    editor.read(() => {
      messageText = $getRoot().getTextContent().trim();
    });
    if (!messageText) return;

    // Enqueue into the durable outbox IMMEDIATELY. The outbox owns delivery,
    // retry, and JSONL reconciliation. This call cannot fail or be dropped.
    onSend?.(messageText);

    // Clear editor ONLY if content still matches what we captured. If the user
    // typed more characters between Lexical read and clear (e.g. very fast
    // typing during rapid Enter), those new characters survive as a new draft.
    editor.update(() => {
      const current = $getRoot().getTextContent();
      if (current.trim() === messageText) {
        $getRoot().clear();
      }
    });
    setText((prev) => (prev.trim() === messageText ? '' : prev));
    editor.focus();

    // If the picker model differs from the server's current session model,
    // kick off a restart in the background. Deliberately NOT awaited — the
    // message is already in the outbox and will be POSTed by the drain loop
    // (retry+backoff absorbs any transient failures during the restart window).
    if (model !== conversation.model && !switchingRef.current) {
      switchingRef.current = switchModel(conversation.name, model)
        .catch((err: unknown) => {
          console.error('[ComposerFooter] switchModel failed:', err);
          toast.error(err instanceof Error ? err.message : 'Model switch failed');
        })
        .finally(() => { switchingRef.current = null; });
    }
  }, [model, conversation.name, conversation.model, conversation.sessionAlive, onSend]);

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
