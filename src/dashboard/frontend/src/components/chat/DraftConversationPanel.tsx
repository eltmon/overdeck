/**
 * DraftConversationPanel
 *
 * Shown when user clicks "+" — no tmux session exists yet.
 * On first message: spawns Claude Code with selected model/effort,
 * creates DB record, sends message, and promotes to ConversationPanel.
 *
 * No terminal toggle in draft mode (nothing running yet).
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { SendHorizontal } from 'lucide-react';
import { $getRoot } from 'lexical';
import type { LexicalEditor } from 'lexical';
import { ComposerPromptEditor } from './ComposerPromptEditor';
import {
  ModelPicker,
  MODEL_EFFORT_SUPPORT,
  FALLBACK_DEFAULT_MODEL,
  loadStoredModel,
  saveStoredModel,
} from './ModelPicker';
import { getDefaultConversationModel, ensureDefaultConversationModel } from './defaultConversationModel';
import { EffortPicker, loadStoredEffort, type EffortLevel } from './EffortPicker';
import type { Conversation } from '../CommandDeck/ConversationList';
import styles from '../CommandDeck/styles/command-deck.module.css';

// ─── API ─────────────────────────────────────────────────────────────────────

/** Single endpoint: spawn session + create conversation + send first message. */
async function spawnAndCreate(
  message: string,
  model: string,
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
  onPromoted: (conv: Conversation, firstMessage: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DraftConversationPanel({ onPromoted }: DraftConversationPanelProps) {
  const [model, setModel] = useState<string>(() => loadStoredModel(getDefaultConversationModel()));
  const [effortLevels, setEffortLevels] = useState<readonly string[]>(
    () => MODEL_EFFORT_SUPPORT[getDefaultConversationModel() as keyof typeof MODEL_EFFORT_SUPPORT] ?? ['low', 'medium', 'high'],
  );
  const [effort, setEffort] = useState<EffortLevel>(loadStoredEffort);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<LexicalEditor | null>(null);
  // Unique key per draft instance so Lexical doesn't reuse stale state
  const draftKey = useMemo(() => `draft-${Date.now()}`, []);

  useEffect(() => {
    let cancelled = false;

    void ensureDefaultConversationModel().then(() => {
      if (cancelled) return;
      const resolvedModel = loadStoredModel(getDefaultConversationModel());
      setModel(resolvedModel);
      setEffortLevels(
        MODEL_EFFORT_SUPPORT[resolvedModel as keyof typeof MODEL_EFFORT_SUPPORT] ??
        MODEL_EFFORT_SUPPORT[FALLBACK_DEFAULT_MODEL as keyof typeof MODEL_EFFORT_SUPPORT] ??
        ['low', 'medium', 'high'],
      );
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-focus the editor when the draft panel mounts (e.g. after clicking "+")
  useEffect(() => {
    // Small delay to let Lexical mount and register the editor instance
    const timer = setTimeout(() => {
      editorRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const isEmpty = text.trim() === '';

  function handleModelChange(newModel: string, levels: readonly string[]) {
    setModel(newModel);
    setEffortLevels(levels);
    saveStoredModel(newModel);
  }

  const handleSubmit = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || sending) return;

    // Read directly from Lexical — React state may be stale if onChange hasn't fired yet
    let messageText = '';
    editor.read(() => {
      messageText = $getRoot().getTextContent().trim();
    });
    if (!messageText) return;

    setSending(true);
    setError(null);
    try {
      const conv = await spawnAndCreate(messageText, model, effort);
      onPromoted(conv, messageText);
    } catch (err) {
      console.error('[DraftConversationPanel] Failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to create conversation');
      setSending(false);
    }
  }, [model, effort, onPromoted, sending]);

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
                conversationName={draftKey}
                disabled={sending}
                onCommandKeyDown={handleCommandKey}
                editorRef={editorRef}
                onChange={setText}
              />
              <div className={styles.composerToolbar}>
                <ModelPicker value={model} onChange={handleModelChange} disabled={sending} />
                <EffortPicker value={effort} onChange={setEffort} disabled={sending} availableLevels={effortLevels} />
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
              <p style={{ color: 'var(--muted-foreground)', fontSize: 12, padding: '4px 8px' }}>
                Starting session...
              </p>
            )}
            {error && (
              <p style={{ color: 'var(--destructive)', fontSize: 12, padding: '4px 8px' }}>
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
