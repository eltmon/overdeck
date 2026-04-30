import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  getDefaultConversationModel,
  ensureDefaultConversationModel,
  FALLBACK_DEFAULT_CONVERSATION_MODEL,
} from '../../chat/defaultConversationModel';
import styles from './ModelPicker.module.css';

export const FALLBACK_COMPACTION_MODEL = 'claude-haiku-4-5-20251001';

export interface PickerModel {
  id: string;
  label: string;
  provider: string;
  costDisplay?: string;
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
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', costDisplay: '$15/1M' },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic', costDisplay: '$45/1M' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic', costDisplay: '$1/1M' },
    ],
  },
];

export function formatCost(costPer1M: number): string {
  if (costPer1M === 0) return 'FREE';
  if (costPer1M < 1) return `$${costPer1M.toFixed(2)}/1M`;
  return `$${Math.round(costPer1M)}/1M`;
}

export function useAvailableModels(): { groups: ModelGroup[]; compactionModel: string; defaultModel: string } {
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

  const defaultModel = getDefaultConversationModel() || FALLBACK_DEFAULT_CONVERSATION_MODEL;
  return { groups, compactionModel, defaultModel };
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
                {group.models.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    className={`${styles.pickerOption} ${model.id === value ? styles.pickerOptionActive : ''}`}
                    onClick={() => { onChange(model.id); setOpen(false); }}
                  >
                    <span className={styles.pickerOptionLabel}>{model.label}</span>
                    {model.costDisplay && (
                      <span className={styles.pickerOptionCost}>{model.costDisplay}</span>
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
