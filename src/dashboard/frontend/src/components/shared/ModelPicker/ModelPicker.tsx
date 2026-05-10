import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  getDefaultConversationModel,
  ensureDefaultConversationModel,
  FALLBACK_DEFAULT_CONVERSATION_MODEL,
} from '../../chat/defaultConversationModel';
import { CostWarningBadge, costWarningLevel } from '../costWarning';
import styles from './ModelPicker.module.css';

export const FALLBACK_COMPACTION_MODEL = 'claude-haiku-4-5-20251001';


export type Harness = 'claude-code' | 'pi';
export type AuthMode = 'api-key' | 'subscription';

export const HARNESS_OPTIONS: Array<{ id: Harness; label: string; description: string }> = [
  { id: 'claude-code', label: 'Claude Code', description: 'Default Claude Code CLI harness' },
  { id: 'pi', label: 'Pi', description: 'Pi RPC harness (no tmux paste-buffer)' },
];

export const PI_TOS_BLOCK_REASON = 'Pi cannot run Anthropic models when authenticated via Claude Code subscription. Switch Anthropic to API-key auth, or pick a non-Anthropic model.';

export type HarnessDecision = { allowed: boolean; reason?: string };
export type HarnessPolicyDecisions = Record<string, Partial<Record<Harness, HarnessDecision>>>;

export function getProviderForPickerModel(modelId: string, groups: ModelGroup[]): string | undefined {
  for (const group of groups) {
    if (group.models.some((model) => model.id === modelId)) return group.provider;
  }
  if (modelId.startsWith('claude-')) return 'anthropic';
  return undefined;
}

export function canUsePickerHarness(
  harness: Harness,
  modelId: string,
  policyDecisions?: HarnessPolicyDecisions,
): HarnessDecision {
  return policyDecisions?.[modelId]?.[harness] ?? { allowed: true };
}

export interface PickerModel {
  id: string;
  label: string;
  provider: string;
  costDisplay?: string;
  /** Raw cost in $/1M tokens — preserved so we can flag expensive models. */
  costPer1MTokens?: number;
}

export interface ModelGroup {
  provider: string;
  label: string;
  models: PickerModel[];
}

export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  minimax: 'MiniMax',
  zai: 'Z.AI',
  kimi: 'Kimi',
  openrouter: 'OpenRouter',
};

export const FALLBACK_GROUPS: ModelGroup[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic',
    models: [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', costDisplay: '$15/1M', costPer1MTokens: 15 },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic', costDisplay: '$45/1M', costPer1MTokens: 45 },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic', costDisplay: '$1/1M', costPer1MTokens: 1 },
    ],
  },
];

export function formatCost(costPer1M: number): string {
  if (costPer1M === 0) return 'FREE';
  if (costPer1M < 1) return `$${costPer1M.toFixed(2)}/1M`;
  return `$${Math.round(costPer1M)}/1M`;
}

type AvailableModelsState = {
  groups: ModelGroup[];
  compactionModel: string;
  authModes: Partial<Record<string, AuthMode>>;
  harnessPolicy: HarnessPolicyDecisions;
};

let availableModelsCache: AvailableModelsState | null = null;
let availableModelsPromise: Promise<AvailableModelsState> | null = null;

async function loadAvailableModelsState(): Promise<AvailableModelsState> {
  if (availableModelsCache) return availableModelsCache;
  if (availableModelsPromise) return availableModelsPromise;

  availableModelsPromise = (async () => {
    let groups = FALLBACK_GROUPS;
    let compactionModel = FALLBACK_COMPACTION_MODEL;
    let authModes: Partial<Record<string, AuthMode>> = {};
    let harnessPolicy: HarnessPolicyDecisions = {};

    try {
      await ensureDefaultConversationModel();
      const [availRes, orRes, settingsRes, claudeAuthRes] = await Promise.allSettled([
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
        fetch('/api/settings/claude-auth').then((r) => r.json()) as Promise<{
          loggedIn?: boolean;
          hasAnthropicApiKey?: boolean;
        }>,
      ]);

      if (settingsRes.status === 'fulfilled' && settingsRes.value?.conversations?.compaction_model) {
        compactionModel = settingsRes.value.conversations.compaction_model;
      }
      if (claudeAuthRes.status === 'fulfilled') {
        authModes = {
          anthropic: claudeAuthRes.value.hasAnthropicApiKey
            ? 'api-key'
            : (claudeAuthRes.value.loggedIn ? 'subscription' : undefined),
        };
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
            costPer1MTokens: m.costPer1MTokens,
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
            costPer1MTokens: m.promptCostPer1M,
          })),
        });
      }

      if (newGroups.length > 0) groups = newGroups;

      const modelIds = groups.flatMap((group) => group.models.map((model) => model.id));
      if (modelIds.length > 0) {
        const policy = await fetch(`/api/settings/harness-policy?models=${encodeURIComponent(modelIds.join(','))}`)
          .then((r) => r.json()) as { decisions?: HarnessPolicyDecisions };
        harnessPolicy = policy.decisions ?? {};
      }
    } catch {
      // keep fallback
    }

    availableModelsCache = { groups, compactionModel, authModes, harnessPolicy };
    return availableModelsCache;
  })();

  return availableModelsPromise;
}

export function useAvailableModels(): AvailableModelsState & { defaultModel: string } {
  const [state, setState] = useState<AvailableModelsState>(
    availableModelsCache ?? {
      groups: FALLBACK_GROUPS,
      compactionModel: FALLBACK_COMPACTION_MODEL,
      authModes: {},
      harnessPolicy: {},
    },
  );

  useEffect(() => {
    let canceled = false;
    void loadAvailableModelsState().then((loaded) => {
      if (!canceled) setState(loaded);
    });
    return () => { canceled = true; };
  }, []);

  const defaultModel = getDefaultConversationModel() || FALLBACK_DEFAULT_CONVERSATION_MODEL;
  return { ...state, defaultModel };
}

export function ModelSelect({
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
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div ref={ref} className={styles.pickerWrap}>
        <button
          type="button"
          className={styles.pickerBtn}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={styles.pickerValue}>{selected?.label ?? value}</span>
          {(() => {
            const lvl = costWarningLevel(selected?.costPer1MTokens);
            return lvl
              ? <CostWarningBadge level={lvl} compact costPer1MTokens={selected?.costPer1MTokens} />
              : null;
          })()}
          {selected?.costDisplay && (
            <span className={styles.pickerCost}>{selected.costDisplay}</span>
          )}
          <ChevronDown size={12} className={styles.pickerChevron} />
        </button>
        {open && (
          <div className={styles.pickerDropdown}>
            {groups.map((group) => (
              <div key={group.provider}>
                {groups.length > 1 && (
                  <div className={styles.pickerGroupHeader}>{group.label}</div>
                )}
                {group.models.map((model) => {
                  const lvl = costWarningLevel(model.costPer1MTokens);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      className={`${styles.pickerOption} ${model.id === value ? styles.pickerOptionActive : ''}`}
                      onClick={() => { onChange(model.id); setOpen(false); }}
                    >
                      <span className={styles.pickerOptionLabel}>{model.label}</span>
                      {lvl && <CostWarningBadge level={lvl} compact costPer1MTokens={model.costPer1MTokens} />}
                      {model.costDisplay && (
                        <span className={styles.pickerOptionCost}>{model.costDisplay}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


export function HarnessSelect({
  value,
  onChange,
  modelId,
  groups,
  harnessPolicy,
  label = 'Harness',
}: {
  value: Harness;
  onChange: (harness: Harness) => void;
  modelId: string;
  groups: ModelGroup[];
  harnessPolicy?: HarnessPolicyDecisions;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = HARNESS_OPTIONS.find((h) => h.id === value) ?? HARNESS_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    const decision = canUsePickerHarness(value, modelId, harnessPolicy);
    if (!decision.allowed) onChange('claude-code');
  }, [value, modelId, harnessPolicy, onChange]);

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div ref={ref} className={styles.pickerWrap}>
        <button type="button" className={styles.pickerBtn} onClick={() => setOpen((o) => !o)}>
          <span className={styles.pickerValue}>{selected.label}</span>
          <ChevronDown size={12} className={styles.pickerChevron} />
        </button>
        {open && (
          <div className={styles.pickerDropdown}>
            {HARNESS_OPTIONS.map((harness) => {
              const decision = canUsePickerHarness(harness.id, modelId, harnessPolicy);
              return (
                <button
                  key={harness.id}
                  type="button"
                  className={`${styles.pickerOption} ${harness.id === value ? styles.pickerOptionActive : ''}`}
                  disabled={!decision.allowed}
                  title={decision.reason ?? harness.description}
                  onClick={() => { if (decision.allowed) { onChange(harness.id); setOpen(false); } }}
                >
                  <span className={styles.pickerOptionLabel}>{harness.label}</span>
                  {!decision.allowed && <span className={styles.pickerOptionCost}>ToS gated</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function ModelHarnessPicker({
  model,
  harness,
  onModelChange,
  onHarnessChange,
  groups,
  harnessPolicy,
  modelLabel = 'Model',
}: {
  model: string;
  harness: Harness;
  onModelChange: (model: string) => void;
  onHarnessChange: (harness: Harness) => void;
  groups: ModelGroup[];
  harnessPolicy?: HarnessPolicyDecisions;
  modelLabel?: string;
}) {
  return (
    <>
      <ModelSelect value={model} onChange={onModelChange} groups={groups} label={modelLabel} />
      <HarnessSelect value={harness} onChange={onHarnessChange} modelId={model} groups={groups} harnessPolicy={harnessPolicy} />
    </>
  );
}
