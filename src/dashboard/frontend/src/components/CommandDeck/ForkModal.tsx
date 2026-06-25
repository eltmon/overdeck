import { useState, useEffect, useRef } from 'react';
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

const FORK_HELP_CONTENT = `## Ways to continue

There are three ways to start a new conversation from this one, from richest to lightest:

### Fresh summary (default)
Sends the conversation history to an LLM to produce a structured summary. For very large conversations, the history is processed in chunks — each chunk builds on the previous summary so arbitrarily long sessions can be summarized.

The summary is injected as the first message in the new session, and the agent is instructed to acknowledge it and wait for your next instruction.

**Best for:** Most cases — gives the new agent a clear understanding of what was accomplished and decided.

**Fast summary** (an advanced toggle) skips the LLM and extracts a bullet list of user messages, files modified, and tools used directly from the history. Cheaper and instant, but rougher.

### Agent handoff
Asks an agent to write a Markdown handoff document, optionally focused on a specific next task or question. The document becomes the seed message for the new conversation.

By default a clean **external** session reads the transcript from disk and writes the document — the source conversation is never touched and can even be ended. Optionally the **source** agent can write it in-conversation (this adds the prompt and doc to the source's context). If a source-authored handoff stalls or produces an invalid document, Overdeck falls back to a summary.

**Best for:** Deliberate handoffs where the dead ends, important files, and suggested next steps matter.

### Exact copy
Copies the raw conversation history into a new session. No summary is generated — the new agent picks up exactly where the previous one left off.

If the conversation was previously compacted, only the history from the last compaction point forward is carried over.

**Best for:** Continuing a conversation that hit a context limit, especially when staying on the same model.

**Cross-model warning:** Raw history may contain model-specific data (like signed thinking blocks) that won't validate on a different provider. Use a summary or handoff when switching models.

---

## Options

### Focus
Used by Agent handoff. Give the author a short prompt about what the successor should focus on.

### Summary / Authoring model
The model used to **generate the summary or handoff document**. Independent of the model the new conversation runs on. Cheaper models like Haiku work well for straightforward cases; use a larger model for complex or nuanced conversations.

### Include thinking
When enabled, the model's internal reasoning (thinking blocks) is included in the text sent to the summarizer. Richer context about **why** decisions were made, but larger input and cost.

### Launch model
The model the **new conversation** will run on. Completely independent of the summary/authoring model. Defaults to the parent conversation's model.
`;

type ApiForkMode = 'summary' | 'plain' | 'handoff';
type ForkModeOption = ApiForkMode | 'fast-summary';
type ForkIntent = 'summary' | 'handoff' | 'plain';
type HandoffAuthor = 'source' | 'external';

const INTENT_LABEL: Record<ForkIntent, string> = {
  summary: 'Summary Fork',
  handoff: 'Handoff',
  plain: 'Plain Fork',
};

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
            <h3 id="fork-help-title" className={styles.forkTitle}>Continue Options</h3>
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
  initialMode?: ForkModeOption;
  initialFocus?: string;
  onConfirm: (
    conv: Conversation,
    launchModel: string,
    summaryModel: string,
    forkMode: ApiForkMode,
    localSummaryOnly: boolean,
    includeThinkingInSummary: boolean,
    title?: string,
    launchHarness?: Harness,
    summaryHarness?: Harness,
    focus?: string,
    handoffAuthor?: HandoffAuthor,
    handoffAuthorModel?: string,
    handoffAuthorHarness?: Harness,
  ) => void;
  onClose: () => void;
  isPending: boolean;
}

export function ForkModal({ conversation, initialMode, initialFocus, onConfirm, onClose, isPending }: ForkModalProps) {
  const { groups, compactionModel, harnessPolicy } = useAvailableModels();
  const defaultModel = getDefaultConversationModel() || FALLBACK_DEFAULT_CONVERSATION_MODEL;

  // Intent is the user-facing choice (3 options). The 4th legacy mode
  // ("fast-summary") is an advanced toggle under the summary intent.
  const initialIntent: ForkIntent =
    initialMode === 'plain' ? 'plain' : initialMode === 'handoff' ? 'handoff' : 'summary';
  const [intent, setIntent] = useState<ForkIntent>(initialIntent);
  const [fastSummary, setFastSummary] = useState(initialMode === 'fast-summary');

  const [launchModel, setLaunchModel] = useState(conversation.model || defaultModel);
  // Plain forks copy Claude JSONL and resume — Pi cannot consume that history,
  // so plain forks force launchHarness back to claude-code. Summary and handoff
  // forks inject portable text after spawn, so Pi launch is fine there subject
  // to the canonical harness policy (ToS gate).
  const [launchHarness, setLaunchHarness] = useState<Harness>((conversation.harness === 'pi' ? 'ohmypi' : conversation.harness) || 'claude-code');
  const [summaryModel, setSummaryModel] = useState(compactionModel);
  const [summaryHarness, setSummaryHarness] = useState<Harness>('claude-code');
  useEffect(() => {
    if (intent === 'plain' && launchHarness !== 'claude-code') {
      setLaunchHarness('claude-code');
    }
  }, [intent, launchHarness]);
  const [includeThinkingInSummary, setIncludeThinkingInSummary] = useState(false);
  const [handoffFocus, setHandoffFocus] = useState(initialFocus ?? '');
  const [handoffAuthor, setHandoffAuthor] = useState<HandoffAuthor>('external');
  // Source-authored handoff requires the harness to support delivering a
  // prompt to the live agent and watching for a sentinel file. Today only
  // Claude Code does that — Pi (and other future harnesses without
  // hook-equivalent signaling) can only do external authoring. Keep this in
  // sync with ConversationTranscriptAdapter.supportsSourceAuthoredHandoff
  // on the server.
  const sourceSupportsSourceAuthoring = (conversation.harness ?? 'claude-code') === 'claude-code';
  useEffect(() => {
    if (!sourceSupportsSourceAuthoring && handoffAuthor === 'source') {
      setHandoffAuthor('external');
    }
  }, [sourceSupportsSourceAuthoring, handoffAuthor]);
  const [showHelp, setShowHelp] = useState(false);

  const convTitle = conversation.title ?? conversation.name;
  const [forkTitle, setForkTitle] = useState(`${INTENT_LABEL[initialIntent]}: ${convTitle}`);
  // The suggested name tracks the chosen intent — but ONLY until the user types
  // their own. Without this guard, switching intent (or a live title update)
  // silently wiped a hand-edited name mid-edit. Once the user customizes the
  // name, their value sticks across intent switches.
  const nameDirtyRef = useRef(false);

  useEffect(() => {
    setSummaryModel(compactionModel);
  }, [compactionModel]);

  useEffect(() => {
    if (!nameDirtyRef.current) {
      setForkTitle(`${INTENT_LABEL[intent]}: ${convTitle}`);
    }
  }, [intent, convTitle]);

  const overlayRef = useRef<HTMLDivElement>(null);

  const forkMode: ForkModeOption =
    intent === 'plain' ? 'plain' : intent === 'handoff' ? 'handoff' : fastSummary ? 'fast-summary' : 'summary';
  const apiForkMode: ApiForkMode = intent === 'plain' ? 'plain' : intent === 'handoff' ? 'handoff' : 'summary';
  const localSummaryOnly = forkMode === 'fast-summary';
  const isPlainFork = intent === 'plain';
  const isHandoffFork = intent === 'handoff';
  const isSummaryFork = intent === 'summary';
  const modelChanged = launchModel !== (conversation.model || defaultModel);
  const showModelSwitchWarning = isPlainFork && modelChanged;
  // Only source-authored handoff requires a live source — external authoring
  // reads the transcript from disk and works on ended conversations.
  const handoffUnavailable = isHandoffFork && handoffAuthor === 'source' && !conversation.sessionAlive;
  const confirmDisabled = isPending || handoffUnavailable;
  const handoffFocusValue = handoffFocus.trim() || undefined;

  const title = conversation.title ?? conversation.name;
  const truncatedTitle = title.length > 50 ? title.slice(0, 47) + '...' : title;

  // Scope keyboard handling to the dialog: Escape closes, and every other key
  // is stopped from bubbling to the conversation-list/row handlers underneath
  // (which react to Space/'f'), so typing in any field can never disturb them.
  const handleDialogKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    e.stopPropagation();
  };

  const intentOptions: { value: ForkIntent; label: string; hint: string }[] = [
    { value: 'summary', label: 'Fresh summary', hint: 'An LLM distills the prior context into a seed message. Best for most cases.' },
    { value: 'handoff', label: 'Agent handoff', hint: 'An agent writes a handoff document — richer, captures dead ends and next steps.' },
    { value: 'plain', label: 'Exact copy', hint: 'Carry over the raw history verbatim. Same model only.' },
  ];

  return (
    <div
      ref={overlayRef}
      className={styles.forkOverlay}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className={styles.forkDialog} role="dialog" aria-labelledby="fork-title" onKeyDown={handleDialogKeyDown}>
        <div className={styles.forkHeader}>
          <div className={styles.forkHeaderLeft}>
            <GitBranchPlus size={16} className={styles.forkHeaderIcon} />
            <h3 id="fork-title" className={styles.forkTitle}>Continue in a new conversation</h3>
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
            From <strong title={title}>{truncatedTitle}</strong>.
          </p>

          <div className={styles.forkFields}>
            {/* Intent — the one decision most users make. */}
            <fieldset className={styles.forkModeGroup}>
              <legend>Start the new agent from</legend>
              {intentOptions.map((opt) => (
                <label key={opt.value} className={styles.forkCheckboxRow}>
                  <input
                    type="radio"
                    name="fork-intent"
                    value={opt.value}
                    checked={intent === opt.value}
                    onChange={() => setIntent(opt.value)}
                  />
                  <span>
                    {opt.label}
                    {opt.value === 'summary' && (
                      <span style={{ marginLeft: 6, color: 'var(--muted-foreground)' }}>· recommended</span>
                    )}
                    <span className={pickerStyles.fieldHint} style={{ display: 'block' }}>{opt.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {/* Name. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label htmlFor="fork-title-input" style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>
                New name
              </label>
              <input
                id="fork-title-input"
                type="text"
                value={forkTitle}
                onChange={(e) => { nameDirtyRef.current = true; setForkTitle(e.target.value); }}
                className={styles.forkTitleInput}
                autoFocus
              />
            </div>

            {/* Launch model — always relevant. */}
            {isPlainFork ? (
              <>
                <ModelSelect
                  value={launchModel}
                  onChange={setLaunchModel}
                  groups={groups}
                  label="Launch model"
                />
                <span className={pickerStyles.fieldHint}>
                  Exact copy always launches under Claude Code — Pi cannot consume the
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
                  The model and harness the new conversation will use.
                </span>
              </>
            )}

            {/* Handoff focus — the primary steering input, so keep it visible. */}
            {isHandoffFork && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                <label htmlFor="handoff-focus-input" style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>
                  Focus (optional)
                </label>
                <textarea
                  id="handoff-focus-input"
                  value={handoffFocus}
                  onChange={(e) => setHandoffFocus(e.target.value)}
                  className={styles.forkTitleInput}
                  rows={3}
                  placeholder="What should the next conversation focus on?"
                />
                <span className={pickerStyles.fieldHint}>
                  {handoffAuthor === 'external'
                    ? 'Steers what the authoring session emphasizes in the handoff document.'
                    : 'Sent to the source agent as guidance for the handoff document.'}
                </span>
              </div>
            )}

            {/* Inline warnings — safety, not advanced. */}
            {showModelSwitchWarning && (
              <div className={styles.forkWarning}>
                <strong>Warning:</strong> Exact copy with a different model may fail
                if the raw history contains provider-specific blocks (e.g., signed thinking
                blocks). Use a summary or handoff for cross-model continues.
              </div>
            )}
            {handoffUnavailable && (
              <div className={styles.forkWarning}>
                Source-authored handoff requires a running source conversation. Switch
                to an external author in Advanced options, or use Fresh summary / Exact copy.
              </div>
            )}

            {/* Advanced options — everything power users still need, tucked away. */}
            <details style={{ borderTop: '1px solid var(--border)', marginTop: '4px', paddingTop: '8px' }}>
              <summary style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 500, color: 'var(--muted-foreground)', userSelect: 'none' }}>
                Advanced options
              </summary>
              <div className={styles.forkFields} style={{ marginTop: '8px' }}>
                {isSummaryFork && (
                  <>
                    <div className={styles.forkCheckboxRow}>
                      <input
                        type="checkbox"
                        id="fast-summary"
                        checked={fastSummary}
                        onChange={(e) => setFastSummary(e.target.checked)}
                      />
                      <label htmlFor="fast-summary">Fast summary (no LLM, heuristic only)</label>
                    </div>
                    <span className={pickerStyles.fieldHint}>
                      Skips the summary model and uses local transcript metadata only — instant and free, but rough.
                    </span>

                    {!fastSummary && (
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
                          When enabled, thinking content is included as labeled text in the summary.
                        </span>
                      </>
                    )}
                  </>
                )}

                {isHandoffFork && (
                  <>
                    <fieldset className={styles.forkModeGroup}>
                      <legend>Authored by</legend>
                      <label className={styles.forkCheckboxRow}>
                        <input
                          type="radio"
                          name="handoff-author"
                          value="external"
                          checked={handoffAuthor === 'external'}
                          onChange={() => setHandoffAuthor('external')}
                        />
                        <span>External session (clean — pick the authoring model below)</span>
                      </label>
                      <label className={styles.forkCheckboxRow}>
                        <input
                          type="radio"
                          name="handoff-author"
                          value="source"
                          checked={handoffAuthor === 'source'}
                          onChange={() => setHandoffAuthor('source')}
                          disabled={!sourceSupportsSourceAuthoring}
                        />
                        <span>
                          Source agent (uses source's model — pollutes the source conversation)
                          {!sourceSupportsSourceAuthoring && (
                            <span style={{ marginLeft: 6, fontStyle: 'italic', color: 'var(--muted-foreground)' }}>
                              — not supported for {conversation.harness} sources
                            </span>
                          )}
                        </span>
                      </label>
                    </fieldset>

                    {handoffAuthor === 'external' && (
                      <>
                        <ModelHarnessPicker
                          model={summaryModel}
                          harness={summaryHarness}
                          onModelChange={setSummaryModel}
                          onHarnessChange={setSummaryHarness}
                          groups={groups}
                          harnessPolicy={harnessPolicy}
                          modelLabel="Authoring model"
                        />
                        <span className={pickerStyles.fieldHint}>
                          The model and harness that read the source transcript and emit the
                          handoff document. Cheaper models work fine; use a larger model for
                          nuanced or long conversations.
                        </span>
                      </>
                    )}
                    {handoffAuthor === 'source' && (
                      <span className={pickerStyles.fieldHint}>
                        Source-authored handoff asks the live source agent to write the seed
                        document, using whatever model the source is currently running.
                      </span>
                    )}
                  </>
                )}

                {isPlainFork && (
                  <span className={pickerStyles.fieldHint}>
                    Exact copy has no extra options — it carries over the raw history from the
                    last compaction point and resumes under Claude Code.
                  </span>
                )}
              </div>
            </details>
          </div>
        </div>

        <div className={styles.forkFooter}>
          <button className={styles.forkCancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.forkConfirmBtn}
            disabled={confirmDisabled}
            title={handoffUnavailable ? 'Source-authored handoff requires a running source conversation' : undefined}
            onClick={() => onConfirm(
              conversation,
              launchModel,
              summaryModel,
              apiForkMode,
              localSummaryOnly,
              isSummaryFork && !fastSummary && includeThinkingInSummary,
              forkTitle.trim() || undefined,
              launchHarness,
              summaryHarness,
              handoffFocusValue,
              isHandoffFork ? handoffAuthor : undefined,
              isHandoffFork && handoffAuthor === 'external' ? summaryModel : undefined,
              isHandoffFork && handoffAuthor === 'external' ? summaryHarness : undefined,
            )}
          >
            <GitBranchPlus size={13} />
            {isPending ? 'Continuing…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
