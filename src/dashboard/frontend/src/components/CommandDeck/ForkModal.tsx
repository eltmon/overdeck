import { useState, useEffect, useRef, useCallback } from 'react';
import { X, GitBranchPlus, HelpCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  getDefaultConversationModel,
  FALLBACK_DEFAULT_CONVERSATION_MODEL,
} from '../chat/defaultConversationModel';
import styles from './styles/command-deck.module.css';
import pickerStyles from '../shared/ModelPicker/ModelPicker.module.css';
import { ModelHarnessPicker, ModelSelect, useAvailableModels } from '../shared/ModelPicker';
import type { Harness } from '../shared/ModelPicker';
import type { Conversation } from './ConversationList';

const FORK_HELP_CONTENT = `## Fork Modes

There are three ways to fork a conversation, from lightest to richest:

### Plain Fork
Copies the raw conversation history into a new session. No summary is generated — the new agent picks up exactly where the previous one left off.

If the conversation was previously compacted, only the history from the last compaction point forward is carried over.

**Best for:** Continuing a conversation that hit a context limit, especially when staying on the same model.

**Cross-model warning:** Raw history may contain model-specific data (like signed thinking blocks) that won't validate on a different provider. Use a summary fork when switching models.

### Fast Summary
Generates a quick summary **without calling an LLM**. Extracts a bullet list of user messages, files modified, and tools used from the conversation history.

**Best for:** Quick forks where you just need a rough reminder of what happened, without paying for an LLM call.

### Full Summary (default)
Sends the conversation history to an LLM to produce a structured summary. For very large conversations, the history is processed in chunks — each chunk builds on the previous summary so arbitrarily long sessions can be summarized.

The summary is injected as the first message in the new session, and the agent is instructed to acknowledge it and wait for your next instruction.

**Best for:** Most forks — gives the new agent a clear understanding of what was accomplished and decided.

---

## Options

### Summary Model
The model used to **generate the summary**. This is independent of the model the new conversation runs on. Cheaper models like Haiku work well for straightforward summarization; use a larger model for complex or nuanced conversations.

### Include Thinking
When enabled, the model's internal reasoning (thinking blocks) is included in the text sent to the summarizer. This gives the summary model richer context about **why** decisions were made, but increases input size and cost.

### Launch Model
The model the **new forked conversation** will run on. Completely independent of the summary model — you can summarize with Haiku and launch on Opus, or vice versa. Defaults to the parent conversation's model.
`;

function ForkHelpModal({ onClose }: { onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className={styles.forkHelpOverlay}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className={styles.forkHelpDialog} role="dialog" aria-labelledby="fork-help-title">
        <div className={styles.forkHeader}>
          <div className={styles.forkHeaderLeft}>
            <HelpCircle size={16} className={styles.forkHeaderIcon} />
            <h3 id="fork-help-title" className={styles.forkTitle}>Fork Options</h3>
          </div>
          <button className={styles.forkClose} onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className={styles.forkHelpBody}>
          <div className={styles.markdownContent}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{FORK_HELP_CONTENT}</ReactMarkdown>
          </div>
        </div>
        <div className={styles.forkFooter}>
          <button className={styles.forkConfirmBtn} onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

interface ForkModalProps {
  conversation: Conversation;
  onConfirm: (
    conv: Conversation,
    launchModel: string,
    summaryModel: string,
    plainFork: boolean,
    localSummaryOnly: boolean,
    includeThinkingInSummary: boolean,
    title?: string,
    launchHarness?: Harness,
    summaryHarness?: Harness,
  ) => void;
  onClose: () => void;
  isPending: boolean;
}

export function ForkModal({ conversation, onConfirm, onClose, isPending }: ForkModalProps) {
  const { groups, compactionModel, harnessPolicy } = useAvailableModels();
  const defaultModel = getDefaultConversationModel() || FALLBACK_DEFAULT_CONVERSATION_MODEL;
  const [launchModel, setLaunchModel] = useState(conversation.model || defaultModel);
  // Plain forks copy Claude JSONL and resume — Pi cannot consume that history,
  // so plainFork forces launchHarness back to claude-code. Summary forks inject
  // a generated summary through the Pi FIFO after spawn, so Pi launch is fine
  // there subject to the canonical harness policy (ToS gate).
  const [launchHarness, setLaunchHarness] = useState<Harness>(conversation.harness || 'claude-code');
  const [summaryModel, setSummaryModel] = useState(compactionModel);
  const [summaryHarness, setSummaryHarness] = useState<Harness>('claude-code');
  const [plainFork, setPlainFork] = useState(false);
  useEffect(() => {
    if (plainFork && launchHarness !== 'claude-code') {
      setLaunchHarness('claude-code');
    }
  }, [plainFork, launchHarness]);
  const [localSummaryOnly, setLocalSummaryOnly] = useState(false);
  const [includeThinkingInSummary, setIncludeThinkingInSummary] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const convTitle = conversation.title ?? conversation.name;
  const [forkTitle, setForkTitle] = useState(`Summary Fork: ${convTitle}`);

  useEffect(() => {
    setSummaryModel(compactionModel);
  }, [compactionModel]);


  const overlayRef = useRef<HTMLDivElement>(null);

  const modelChanged = launchModel !== (conversation.model || defaultModel);
  const showModelSwitchWarning = plainFork && modelChanged;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const title = conversation.title ?? conversation.name;
  const truncatedTitle = title.length > 50 ? title.slice(0, 47) + '...' : title;

  return (
    <div
      ref={overlayRef}
      className={styles.forkOverlay}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className={styles.forkDialog} role="dialog" aria-labelledby="fork-title">
        <div className={styles.forkHeader}>
          <div className={styles.forkHeaderLeft}>
            <GitBranchPlus size={16} className={styles.forkHeaderIcon} />
            <h3 id="fork-title" className={styles.forkTitle}>Fork Conversation</h3>
          </div>
          <div className={styles.forkHeaderRight}>
            <button className={styles.forkClose} onClick={() => setShowHelp(true)} aria-label="Help">
              <HelpCircle size={14} />
            </button>
            <button className={styles.forkClose} onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
        </div>

        {showHelp && <ForkHelpModal onClose={() => setShowHelp(false)} />}

        <div className={styles.forkBody}>
          <p className={styles.forkDesc}>
            {plainFork ? (
              <>
                Create a plain fork of{' '}
                <strong title={title}>{truncatedTitle}</strong>.
                The new conversation will carry over the raw history
                (from the last compaction point, if any) without generating a summary.
              </>
            ) : (
              <>
                Create a new conversation seeded with a summary of{' '}
                <strong title={title}>{truncatedTitle}</strong>.
                The summary agent will distill the prior context so the new session can continue seamlessly.
              </>
            )}
          </p>

          <div className={styles.forkFields}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
              <label htmlFor="fork-title-input" style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>
                Fork name
              </label>
              <input
                id="fork-title-input"
                type="text"
                value={forkTitle}
                onChange={(e) => setForkTitle(e.target.value)}
                className={styles.forkTitleInput}
                autoFocus
              />
            </div>

            <div className={styles.forkCheckboxRow}>
              <input
                type="checkbox"
                id="plain-fork"
                checked={plainFork}
                onChange={(e) => setPlainFork(e.target.checked)}
              />
              <label htmlFor="plain-fork">Plain fork (skip summary, copy raw history)</label>
            </div>

            {showModelSwitchWarning && (
              <div className={styles.forkWarning}>
                <strong>Warning:</strong> Plain fork with a different model may fail
                if the raw history contains provider-specific blocks (e.g., signed thinking
                blocks). Use a summary fork for cross-model forks.
              </div>
            )}

            {!plainFork && (
              <>
                <div className={styles.forkCheckboxRow}>
                  <input
                    type="checkbox"
                    id="local-summary"
                    checked={localSummaryOnly}
                    onChange={(e) => setLocalSummaryOnly(e.target.checked)}
                  />
                  <label htmlFor="local-summary">Fast summary (no LLM, heuristic only)</label>
                </div>

                {!localSummaryOnly && (
                  <>
                    <ModelHarnessPicker
                      model={summaryModel}
                      harness={summaryHarness}
                      onModelChange={setSummaryModel}
                      onHarnessChange={setSummaryHarness}
                      groups={groups}
                      harnessPolicy={harnessPolicy}
                      modelLabel="Summary model"
                    />
                    <span className={pickerStyles.fieldHint}>
                      Generates a concise summary of the conversation history.
                    </span>
                  </>
                )}

                <div className={styles.forkCheckboxRow}>
                  <input
                    type="checkbox"
                    id="include-thinking"
                    checked={includeThinkingInSummary}
                    onChange={(e) => setIncludeThinkingInSummary(e.target.checked)}
                  />
                  <label htmlFor="include-thinking">Include thinking in summary</label>
                </div>
                <span className={pickerStyles.fieldHint}>
                  When enabled, thinking content is included as labeled text in the summary
                </span>
              </>
            )}

            {plainFork ? (
              <>
                <ModelSelect
                  value={launchModel}
                  onChange={setLaunchModel}
                  groups={groups}
                  label="Launch model"
                />
                <span className={pickerStyles.fieldHint}>
                  Plain forks always launch under Claude Code — Pi cannot consume the
                  copied Claude session history.
                </span>
              </>
            ) : (
              <>
                <ModelHarnessPicker
                  model={launchModel}
                  harness={launchHarness}
                  onModelChange={setLaunchModel}
                  onHarnessChange={setLaunchHarness}
                  groups={groups}
                  harnessPolicy={harnessPolicy}
                  modelLabel="Launch model"
                />
                <span className={pickerStyles.fieldHint}>
                  The model and harness the new forked conversation will use.
                </span>
              </>
            )}
          </div>
        </div>

        <div className={styles.forkFooter}>
          <button className={styles.forkCancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.forkConfirmBtn}
            disabled={isPending}
            onClick={() => onConfirm(conversation, launchModel, summaryModel, plainFork, localSummaryOnly, includeThinkingInSummary, forkTitle.trim() || undefined, launchHarness, summaryHarness)}
          >
            <GitBranchPlus size={13} />
            {isPending ? 'Forking...' : 'Fork Conversation'}
          </button>
        </div>
      </div>
    </div>
  );
}
