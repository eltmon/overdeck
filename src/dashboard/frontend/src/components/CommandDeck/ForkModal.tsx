import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, GitBranchPlus, HelpCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { capture } from '../../lib/telemetry';
import {
  getDefaultConversationModel,
  FALLBACK_DEFAULT_CONVERSATION_MODEL,
} from '../chat/defaultConversationModel';
import styles from './styles/command-deck.module.css';
import { Modal } from '../shared/Modal';
import formStyles from '../shared/ModalForm.module.css';
import { ModelHarnessPicker, ModelSelect, useAvailableModels } from '../shared/ModelPicker';
import type { Harness } from '../shared/ModelPicker';
import type { Conversation } from './ConversationList';
import { NO_PROJECT_LABEL, resolveConversationProject, type RegisteredProjectLite } from './projectsData';
import { parseHandoffComposerArgs } from './handoffComposerArgs';

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

### Fresh start
Starts a clean conversation that takes only this conversation's project, working directory, model and effort. No summary or handoff document is written, the new conversation is not linked as a successor, and the Focus text is sent as its first message.

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
  return (
    <Modal
      title="Continue Options"
      size="narrow"
      onClose={onClose}
      // Keys pressed in this nested dialog must not reach the conversation
      // list/row handlers underneath (they react to Space/'f').
      onKeyDown={(e) => e.stopPropagation()}
      footer={
        <button type="button" className={formStyles.primaryButton} onClick={onClose}>
          Got it
        </button>
      }
    >
      <div className={formStyles.content}>
        <div className={styles.markdownContent}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{FORK_HELP_CONTENT}</ReactMarkdown>
        </div>
      </div>
    </Modal>
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
    projectKey?: string,
    handoffExtras?: { skills?: string[]; packs?: string[]; hold?: boolean; fresh?: boolean },
  ) => void;
  onClose: () => void;
  isPending: boolean;
}

export function ForkModal({ conversation, initialMode, initialFocus, onConfirm, onClose, isPending }: ForkModalProps) {
  const { groups, compactionModel } = useAvailableModels();
  const defaultModel = getDefaultConversationModel() || FALLBACK_DEFAULT_CONVERSATION_MODEL;
  const { data: registeredProjects = [] } = useQuery({
    queryKey: ['registered-projects'],
    queryFn: async (): Promise<RegisteredProjectLite[]> => {
      const response = await fetch('/api/registered-projects');
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60_000,
  });
  const sourceProject = resolveConversationProject(conversation, registeredProjects);
  const sourceProjectLabel = sourceProject?.name ?? sourceProject?.key ?? NO_PROJECT_LABEL;
  const [projectKey, setProjectKey] = useState('');

  // Intent is the user-facing choice (up to 3 options). The 4th legacy mode
  // ("fast-summary") is an advanced toggle under the summary intent.
  // ACP (including OpenCode and Grok Build) and Prime Agent transcripts are portable only through summary/handoff
  // adapters; the server rejects an exact-copy fork from those sources.
  const sourceSupportsPlainFork = conversation.harness !== 'acp' && conversation.harness !== 'opencode' && conversation.harness !== 'grok' && conversation.harness !== 'antigravity' && conversation.harness !== 'prime-agent';
  const initialIntent: ForkIntent =
    initialMode === 'plain' && sourceSupportsPlainFork
      ? 'plain'
      : initialMode === 'handoff'
        ? 'handoff'
        : 'summary';
  const [intent, setIntent] = useState<ForkIntent>(initialIntent);
  const [fastSummary, setFastSummary] = useState(initialMode === 'fast-summary');

  const [launchModel, setLaunchModel] = useState(conversation.model || defaultModel);
  const [summaryModel, setSummaryModel] = useState(compactionModel);
  const [includeThinkingInSummary, setIncludeThinkingInSummary] = useState(false);
  // PAN-4499 D13: --skill/--pack/--hold tokens are parsed out of the composer
  // text wherever they appear and never reach the Focus field.
  const parsedComposerArgs = parseHandoffComposerArgs(initialFocus);
  const [handoffFocus, setHandoffFocus] = useState(parsedComposerArgs.focus ?? '');
  const [handoffSkills, setHandoffSkills] = useState(parsedComposerArgs.skills);
  const [handoffPacks, setHandoffPacks] = useState(parsedComposerArgs.packs);
  const [handoffHold, setHandoffHold] = useState(parsedComposerArgs.hold);
  // PAN-4565: a fresh start borrows only the source's defaults — no summary,
  // no handoff document, no parent link.
  const [freshStart, setFreshStart] = useState(parsedComposerArgs.fresh);
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
      // PAN-4565: a fresh start has no document/summary to name after, so it
      // defaults to blank — titled from the first message once sent, or left
      // as the server's "New conversation" fallback.
      setForkTitle(intent === 'handoff' && freshStart ? '' : `${INTENT_LABEL[intent]}: ${convTitle}`);
    }
  }, [intent, convTitle, freshStart]);

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
  // reads the transcript from disk and works on ended conversations. A fresh
  // start needs no live source at all (PAN-4565): it never reads the source
  // transcript.
  const handoffUnavailable = isHandoffFork && !freshStart && handoffAuthor === 'source' && !conversation.sessionAlive;
  const freshHoldNeedsFocus = isHandoffFork && freshStart && handoffHold && !handoffFocus.trim();
  const confirmDisabled = isPending || handoffUnavailable || freshHoldNeedsFocus;
  const handoffFocusValue = handoffFocus.trim() || undefined;

  const title = conversation.title ?? conversation.name;
  const truncatedTitle = title.length > 50 ? title.slice(0, 47) + '...' : title;

  // Scope keyboard handling to the dialog: every key is stopped from bubbling
  // to the conversation-list/row handlers underneath (which react to
  // Space/'f'), so typing in any field can never disturb them. Modal still
  // handles Escape and Tab after this runs.
  const handleDialogKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
  };

  const intentOptions: { value: ForkIntent; label: string; hint: string }[] = [
    { value: 'summary', label: 'Fresh summary', hint: 'An LLM distills the prior context into a seed message. Best for most cases.' },
    { value: 'handoff', label: 'Agent handoff', hint: 'An agent writes a handoff document — richer, captures dead ends and next steps.' },
    ...(sourceSupportsPlainFork
      ? [{ value: 'plain' as const, label: 'Exact copy', hint: 'Carry over the raw history verbatim. Same model only.' }]
      : []),
  ];

  return (
    <Modal
      title="Continue in a new conversation"
      onClose={onClose}
      onKeyDown={handleDialogKeyDown}
      headerActions={
        <button type="button" className={styles.forkClose} aria-label="Help" onClick={() => setShowHelp(true)}>
          <HelpCircle size={14} />
        </button>
      }
      footer={
        <>
          <button type="button" className={formStyles.button} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={formStyles.primaryButton}
            disabled={confirmDisabled}
            title={
              handoffUnavailable
                ? 'Source-authored handoff requires a running source conversation'
                : freshHoldNeedsFocus
                  ? 'Hold needs a first message'
                  : undefined
            }
            onClick={() => {
              capture('conversation_forked', {
                fork_intent: intent,
                fork_mode: apiForkMode,
                fast_summary: localSummaryOnly,
                launch_harness: conversation.harness || 'claude-code',
                fresh_start: isHandoffFork && freshStart,
              });
              onConfirm(
                conversation,
                launchModel,
                summaryModel,
                apiForkMode,
                localSummaryOnly,
                isSummaryFork && !fastSummary && includeThinkingInSummary,
                forkTitle.trim() || undefined,
                isPlainFork ? 'claude-code' : undefined,
                undefined,
                handoffFocusValue,
                isHandoffFork && !freshStart ? handoffAuthor : undefined,
                isHandoffFork && !freshStart && handoffAuthor === 'external' ? summaryModel : undefined,
                undefined,
                projectKey || undefined,
                isHandoffFork && (handoffSkills.length > 0 || handoffPacks.length > 0 || handoffHold || freshStart)
                  ? {
                      ...(handoffSkills.length > 0 ? { skills: handoffSkills } : {}),
                      ...(handoffPacks.length > 0 ? { packs: handoffPacks } : {}),
                      ...(handoffHold ? { hold: true } : {}),
                      ...(freshStart ? { fresh: true } : {}),
                    }
                  : undefined,
              );
            }}
          >
            <GitBranchPlus size={13} />
            {isPending ? 'Continuing…' : 'Continue'}
          </button>
        </>
      }
    >
      {showHelp && <ForkHelpModal onClose={() => setShowHelp(false)} />}

      <div className={formStyles.form}>
        <p className={formStyles.hint}>
          From <strong title={title}>{truncatedTitle}</strong>.
        </p>

        {/* Intent — the one decision most users make. */}
        <fieldset className={formStyles.fieldset}>
          <legend className={`${formStyles.label} mb-2.5`}>Start the new agent from</legend>
          {intentOptions.map((opt) => (
            <label key={opt.value} className={formStyles.choice}>
              <input
                type="radio"
                name="fork-intent"
                value={opt.value}
                checked={intent === opt.value}
                onChange={() => setIntent(opt.value)}
              />
              <span className="min-w-0">
                <span className={formStyles.choiceTitle}>
                  {opt.label}
                  {opt.value === 'summary' && (
                    <span style={{ marginLeft: 6, color: 'var(--muted-foreground)' }}>· recommended</span>
                  )}
                </span>
                <span className={formStyles.choiceHint}>{opt.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {/* Name. */}
        <div className={formStyles.field}>
          <label htmlFor="fork-title-input" className={formStyles.label}>
            New name
          </label>
          <input
            id="fork-title-input"
            type="text"
            value={forkTitle}
            onChange={(e) => { nameDirtyRef.current = true; setForkTitle(e.target.value); }}
            className={formStyles.input}
            placeholder={isHandoffFork && freshStart ? 'Named from the first message' : undefined}
            autoFocus
          />
        </div>

        {/* Project association — independent of the successor cwd. */}
        <div className={formStyles.field}>
          <label htmlFor="fork-project-select" className={formStyles.label}>
            Project
          </label>
          <select
            id="fork-project-select"
            value={projectKey}
            onChange={(event) => setProjectKey(event.target.value)}
            className={formStyles.select}
          >
            <option value="">Same as source ({sourceProjectLabel})</option>
            {registeredProjects.map((project) => (
              <option key={project.key} value={project.key}>{project.name ?? project.key}</option>
            ))}
          </select>
        </div>

        {/* Launch model — always relevant. */}
        {isPlainFork ? (
          <div className={formStyles.field}>
            <ModelSelect
              value={launchModel}
              onChange={setLaunchModel}
              groups={groups}
              label="Launch model"
            />
            <p className={formStyles.hint}>
              Exact copy always launches under Claude Code — Pi cannot consume the
              copied Claude session history.
            </p>
          </div>
        ) : (
          <div className={formStyles.field}>
            <ModelHarnessPicker
              model={launchModel}
              onModelChange={setLaunchModel}
              groups={groups}
              modelLabel="Launch model"
            />
            <p className={formStyles.hint}>
              The model and harness the new conversation will use.
            </p>
          </div>
        )}

        {/* Handoff focus — the primary steering input, so keep it visible. */}
        {isHandoffFork && (
          <div className={formStyles.field}>
            <label htmlFor="handoff-focus-input" className={formStyles.label}>
              {freshStart ? 'First message (optional)' : 'Focus (optional)'}
            </label>
            <textarea
              id="handoff-focus-input"
              value={handoffFocus}
              onChange={(e) => setHandoffFocus(e.target.value)}
              className={formStyles.textarea}
              rows={3}
              placeholder="What should the next conversation focus on?"
            />
            <p className={formStyles.hint}>
              {freshStart
                ? "Sent verbatim as the new conversation's first message. Nothing from this conversation is carried over."
                : handoffAuthor === 'external'
                  ? 'Steers what the authoring session emphasizes in the handoff document.'
                  : 'Sent to the source agent as guidance for the handoff document.'}
            </p>
          </div>
        )}

        {/* PAN-4499 D13: skills/packs/hold parsed from the composer text. */}
        {isHandoffFork && (handoffSkills.length > 0 || handoffPacks.length > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {handoffSkills.map((skill) => (
              <span key={`skill-${skill}`} className={formStyles.hint} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                Skill: {skill}
                <button type="button" aria-label={`Remove skill ${skill}`} onClick={() => setHandoffSkills((prev) => prev.filter((s) => s !== skill))}>
                  <X size={10} />
                </button>
              </span>
            ))}
            {handoffPacks.map((pack) => (
              <span key={`pack-${pack}`} className={formStyles.hint} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                Pack: {pack}
                <button type="button" aria-label={`Remove pack ${pack}`} onClick={() => setHandoffPacks((prev) => prev.filter((p) => p !== pack))}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        {isHandoffFork && (
          <div className={formStyles.fieldset}>
            <label className={formStyles.choice}>
              <input
                type="checkbox"
                checked={handoffHold}
                onChange={(e) => setHandoffHold(e.target.checked)}
              />
              <span className={formStyles.choiceTitle}>Hold — start it myself</span>
            </label>
            <label className={formStyles.choice}>
              <input
                type="checkbox"
                checked={freshStart}
                onChange={(e) => setFreshStart(e.target.checked)}
              />
              <span className={formStyles.choiceTitle}>Fresh start — no summary, no parent link</span>
            </label>
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
        <details className={formStyles.details}>
          <summary>Advanced options</summary>
          <div className="flex flex-col gap-4">
            {isSummaryFork && (
              <>
                <div className={formStyles.field}>
                  <div className={formStyles.choice}>
                    <input
                      type="checkbox"
                      id="fast-summary"
                      checked={fastSummary}
                      onChange={(e) => setFastSummary(e.target.checked)}
                    />
                    <label htmlFor="fast-summary" className={formStyles.choiceTitle}>Fast summary (no LLM, heuristic only)</label>
                  </div>
                  <p className={formStyles.hint}>
                    Skips the summary model and uses local transcript metadata only — instant and free, but rough.
                  </p>
                </div>

                {!fastSummary && (
                  <>
                    <div className={formStyles.field}>
                      <ModelHarnessPicker
                        model={summaryModel}
                        onModelChange={setSummaryModel}
                        groups={groups}
                        modelLabel="Summary model"
                      />
                      <p className={formStyles.hint}>
                        Generates a concise summary of the conversation history.
                      </p>
                    </div>

                    <div className={formStyles.field}>
                      <div className={formStyles.choice}>
                        <input
                          type="checkbox"
                          id="include-thinking"
                          checked={includeThinkingInSummary}
                          onChange={(e) => setIncludeThinkingInSummary(e.target.checked)}
                        />
                        <label htmlFor="include-thinking" className={formStyles.choiceTitle}>Include thinking in summary</label>
                      </div>
                      <p className={formStyles.hint}>
                        When enabled, thinking content is included as labeled text in the summary.
                      </p>
                    </div>
                  </>
                )}
              </>
            )}

            {isHandoffFork && !freshStart && (
              <>
                <fieldset className={formStyles.fieldset}>
                  <legend className={`${formStyles.label} mb-2.5`}>Authored by</legend>
                  <label className={formStyles.choice}>
                    <input
                      type="radio"
                      name="handoff-author"
                      value="external"
                      checked={handoffAuthor === 'external'}
                      onChange={() => setHandoffAuthor('external')}
                    />
                    <span className={formStyles.choiceTitle}>External session (clean — pick the authoring model below)</span>
                  </label>
                  <label className={formStyles.choice}>
                    <input
                      type="radio"
                      name="handoff-author"
                      value="source"
                      checked={handoffAuthor === 'source'}
                      onChange={() => setHandoffAuthor('source')}
                      disabled={!sourceSupportsSourceAuthoring}
                    />
                    <span className="min-w-0">
                      <span className={formStyles.choiceTitle}>Source agent (uses source's model — pollutes the source conversation)</span>
                      {!sourceSupportsSourceAuthoring && (
                        <span className={formStyles.choiceHint} style={{ fontStyle: 'italic' }}>
                          — not supported for {conversation.harness} sources
                        </span>
                      )}
                    </span>
                  </label>
                </fieldset>

                {handoffAuthor === 'external' && (
                  <div className={formStyles.field}>
                    <ModelHarnessPicker
                      model={summaryModel}
                      onModelChange={setSummaryModel}
                      groups={groups}
                      modelLabel="Authoring model"
                    />
                    <p className={formStyles.hint}>
                      The model and harness that read the source transcript and emit the
                      handoff document. Cheaper models work fine; use a larger model for
                      nuanced or long conversations.
                    </p>
                  </div>
                )}
                {handoffAuthor === 'source' && (
                  <p className={formStyles.hint}>
                    Source-authored handoff asks the live source agent to write the seed
                    document, using whatever model the source is currently running.
                  </p>
                )}
              </>
            )}

            {isPlainFork && (
              <p className={formStyles.hint}>
                Exact copy has no extra options — it carries over the raw history from the
                last compaction point and resumes under Claude Code.
              </p>
            )}
          </div>
        </details>
      </div>
    </Modal>
  );
}
