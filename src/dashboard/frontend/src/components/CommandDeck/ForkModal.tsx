import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronDown, GitBranchPlus } from 'lucide-react';
import {
  getDefaultConversationModel,
  ensureDefaultConversationModel,
  FALLBACK_DEFAULT_CONVERSATION_MODEL,
} from '../chat/defaultConversationModel';
import styles from './styles/command-deck.module.css';

const FALLBACK_COMPACTION_MODEL = 'claude-haiku-4-5-20251001';
import type { Conversation } from './ConversationList';

interface PickerModel {
  id: string;
  label: string;
  provider: string;
  costDisplay?: string;
}

interface ModelGroup {
  provider: string;
  label: string;
  models: PickerModel[];
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  minimax: 'MiniMax',
  zai: 'Z.AI',
  kimi: 'Kimi',
  openrouter: 'OpenRouter',
};

const FALLBACK_GROUPS: ModelGroup[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic',
    models: [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', costDisplay: '$15/1M' },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic', costDisplay: '$45/1M' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic', costDisplay: '$1/1M' },
    ],
  },
];

function formatCost(costPer1M: number): string {
  if (costPer1M === 0) return 'FREE';
  if (costPer1M < 1) return `$${costPer1M.toFixed(2)}/1M`;
  return `$${Math.round(costPer1M)}/1M`;
}

function useAvailableModels(): { groups: ModelGroup[]; compactionModel: string } {
  const [groups, setGroups] = useState<ModelGroup[]>(FALLBACK_GROUPS);
  const [compactionModel, setCompactionModel] = useState(FALLBACK_COMPACTION_MODEL);

  useEffect(() => {
    async function load() {
      try {
        await ensureDefaultConversationModel();
        const [availRes, orRes, settingsRes] = await Promise.allSettled([
          fetch('/api/settings/available-models').then((r) => r.json()) as Promise<
            Record<string, Array<{ id: string; name: string; costPer1MTokens: number }>>
          >,
          fetch('/api/settings/openrouter/models').then((r) => r.json()) as Promise<{
            models: Array<{ id: string; name: string; promptCostPer1M: number }>;
            favorites: string[];
          }>,
          fetch('/api/settings').then((r) => r.json()) as Promise<{
            conversations?: { compaction_model?: string };
          }>,
        ]);

        if (settingsRes.status === 'fulfilled' && settingsRes.value?.conversations?.compaction_model) {
          setCompactionModel(settingsRes.value.conversations.compaction_model);
        }

        const avail = availRes.status === 'fulfilled' ? availRes.value : {};
        const orData = orRes.status === 'fulfilled' ? orRes.value : { models: [], favorites: [] };
        const newGroups: ModelGroup[] = [];

        for (const [prov, models] of Object.entries(avail)) {
          if (prov === 'openrouter') continue;
          if (!Array.isArray(models) || models.length === 0) continue;
          newGroups.push({
            provider: prov,
            label: PROVIDER_LABELS[prov] ?? prov,
            models: models.map((m) => ({
              id: m.id,
              label: m.name,
              provider: prov,
              costDisplay: formatCost(m.costPer1MTokens),
            })),
          });
        }

        const orFavorites: string[] = orData.favorites ?? [];
        const orFavoriteModels = (orData.models ?? []).filter((m) => orFavorites.includes(m.id));
        if (orFavoriteModels.length > 0) {
          newGroups.push({
            provider: 'openrouter',
            label: 'OpenRouter',
            models: orFavoriteModels.map((m) => ({
              id: m.id,
              label: m.name,
              provider: 'openrouter',
              costDisplay: formatCost(m.promptCostPer1M),
            })),
          });
        }

        if (newGroups.length > 0) setGroups(newGroups);
      } catch {
        // keep fallback
      }
    }
    void load();
  }, []);

  return { groups, compactionModel };
}

function ModelSelect({
  value,
  onChange,
  groups,
  label,
}: {
  value: string;
  onChange: (id: string) => void;
  groups: ModelGroup[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const allModels = groups.flatMap((g) => g.models);
  const selected = allModels.find((m) => m.id === value);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className={styles.forkField}>
      <span className={styles.forkFieldLabel}>{label}</span>
      <div ref={ref} className={styles.forkPickerWrap}>
        <button
          type="button"
          className={styles.forkPickerBtn}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={styles.forkPickerValue}>{selected?.label ?? value}</span>
          {selected?.costDisplay && (
            <span className={styles.forkPickerCost}>{selected.costDisplay}</span>
          )}
          <ChevronDown size={12} className={styles.forkPickerChevron} />
        </button>
        {open && (
          <div className={styles.forkPickerDropdown}>
            {groups.map((group) => (
              <div key={group.provider}>
                {groups.length > 1 && (
                  <div className={styles.forkPickerGroupHeader}>{group.label}</div>
                )}
                {group.models.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    className={`${styles.forkPickerOption} ${model.id === value ? styles.forkPickerOptionActive : ''}`}
                    onClick={() => { onChange(model.id); setOpen(false); }}
                  >
                    <span className={styles.forkPickerOptionLabel}>{model.label}</span>
                    {model.costDisplay && (
                      <span className={styles.forkPickerOptionCost}>{model.costDisplay}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
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
  ) => void;
  onClose: () => void;
  isPending: boolean;
}

export function ForkModal({ conversation, onConfirm, onClose, isPending }: ForkModalProps) {
  const { groups, compactionModel } = useAvailableModels();
  const defaultModel = getDefaultConversationModel() || FALLBACK_DEFAULT_CONVERSATION_MODEL;
  const [launchModel, setLaunchModel] = useState(conversation.model || defaultModel);
  const [summaryModel, setSummaryModel] = useState(compactionModel);
  const [plainFork, setPlainFork] = useState(false);
  const [localSummaryOnly, setLocalSummaryOnly] = useState(false);
  const [includeThinkingInSummary, setIncludeThinkingInSummary] = useState(false);

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
          <button className={styles.forkClose} onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

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
                    <ModelSelect
                      value={summaryModel}
                      onChange={setSummaryModel}
                      groups={groups}
                      label="Summary model"
                    />
                    <span className={styles.forkFieldHint}>
                      Generates a concise summary of the conversation history
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
                <span className={styles.forkFieldHint}>
                  When enabled, thinking content is included as labeled text in the summary
                </span>
              </>
            )}

            <ModelSelect
              value={launchModel}
              onChange={setLaunchModel}
              groups={groups}
              label="Launch model"
            />
            <span className={styles.forkFieldHint}>
              The model the new forked conversation will use
            </span>
          </div>
        </div>

        <div className={styles.forkFooter}>
          <button className={styles.forkCancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.forkConfirmBtn}
            disabled={isPending}
            onClick={() => onConfirm(conversation, launchModel, summaryModel, plainFork, localSummaryOnly, includeThinkingInSummary)}
          >
            <GitBranchPlus size={13} />
            {isPending ? 'Forking...' : 'Fork Conversation'}
          </button>
        </div>
      </div>
    </div>
  );
}
