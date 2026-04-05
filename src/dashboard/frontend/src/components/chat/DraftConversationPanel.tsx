/**
 * DraftConversationPanel
 *
 * Shown when user clicks "+" — no tmux session exists yet.
 * On first message: spawns Claude Code with selected model/effort,
 * creates DB record, sends message, and promotes to ConversationPanel.
 *
 * No terminal toggle in draft mode (nothing running yet).
 */

import { useState, useRef, useCallback } from 'react';
import { SendHorizontal } from 'lucide-react';
import { $getRoot } from 'lexical';
import type { LexicalEditor } from 'lexical';
import { ComposerPromptEditor } from './ComposerPromptEditor';
import { ModelPicker, loadStoredModel, MODEL_EFFORT_SUPPORT, type ClaudeModelId } from './ModelPicker';
import { EffortPicker, loadStoredEffort, type EffortLevel } from './EffortPicker';
import type { Conversation } from '../MissionControl/ConversationList';
import styles from '../MissionControl/styles/mission-control.module.css';

// ─── API ─────────────────────────────────────────────────────────────────────

/** Single endpoint: spawn session + create conversation + send first message. */
async function spawnAndCreate(
  message: string,
  model: ClaudeModelId,
  effort: EffortLevel,
): Promise<Conversation> {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, model, effort }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error((err as { error?: string }).error || 'Failed to create conversation');
  }
  return res.json();
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface DraftConversationPanelProps {
  onPromoted: (conv: Conversation) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DraftConversationPanel({ onPromoted }: DraftConversationPanelProps) {
  const [model, setModel] = useState<ClaudeModelId>(loadStoredModel);
  const [effort, setEffort] = useState<EffortLevel>(loadStoredEffort);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<LexicalEditor | null>(null);

  const isEmpty = text.trim() === '';
  const availableEfforts = MODEL_EFFORT_SUPPORT[model] ?? [];

  const handleSubmit = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || isEmpty || sending) return;

    let messageText = '';
    editor.read(() => {
      messageText = $getRoot().getTextContent().trim();
    });
    if (!messageText) return;

    setSending(true);
    setError(null);
    try {
      const conv = await spawnAndCreate(messageText, model, effort);
      onPromoted(conv);
    } catch (err) {
      console.error('[DraftConversationPanel] Failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to create conversation');
      setSending(false);
    }
  }, [model, effort, onPromoted, isEmpty, sending]);

  const handleCommandKey = useCallback(
    (key: 'Enter') => {
      if (key === 'Enter') void handleSubmit();
    },
    [handleSubmit],
  );

  return (
    <div className={styles.conversationTerminal}>
      {/* Header bar */}
      <div className={styles.conversationTerminalHeader}>
        <span className={styles.conversationTerminalTitle}>New conversation</span>
      </div>

      {/* Body */}
      <div className={styles.conversationTerminalBody}>
        <div className={styles.conversationView}>
          <div className={styles.conversationEmptyState}>
            <p className={styles.conversationEmptyStateTitle}>How can I help you?</p>
            <p className={styles.conversationEmptyStateSubtitle}>
              Type a message below to start the conversation.
            </p>
          </div>
          <div className={styles.composerFooter}>
            <div className={styles.composerBox}>
              <ComposerPromptEditor
                conversationName="draft"
                disabled={sending}
                onCommandKeyDown={handleCommandKey}
                editorRef={editorRef}
                onChange={setText}
              />
              <div className={styles.composerToolbar}>
                <ModelPicker value={model} onChange={setModel} disabled={sending} />
                <EffortPicker value={effort} onChange={setEffort} disabled={sending} availableLevels={availableEfforts} />
                <div className={styles.composerToolbarSpacer} />
                <button
                  className={styles.sendButton}
                  onClick={() => void handleSubmit()}
                  disabled={isEmpty || sending}
                  type="button"
                  title="Send message (Enter)"
                >
                  <SendHorizontal size={16} />
                </button>
              </div>
            </div>
            {sending && (
              <p style={{ color: 'var(--mc-text-muted)', fontSize: 12, padding: '4px 8px' }}>
                Starting session...
              </p>
            )}
            {error && (
              <p style={{ color: 'var(--mc-error)', fontSize: 12, padding: '4px 8px' }}>
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
