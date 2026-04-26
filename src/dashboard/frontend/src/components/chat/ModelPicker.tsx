/**
 * ModelPicker (PAN-479)
 *
 * Dropdown for selecting the model to use in a conversation.
 * Fetches available models from all enabled providers (including OpenRouter favorites).
 * Groups by provider, shows per-model cost, and exposes effort level support.
 * Selection is persisted to localStorage.
 */

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  FALLBACK_DEFAULT_CONVERSATION_MODEL,
  getDefaultConversationModel,
  ensureDefaultConversationModel,
} from './defaultConversationModel';
import { usePickerPosition } from './usePickerPosition';
import styles from '../CommandDeck/styles/command-deck.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PickerModel {
  id: string;
  label: string;
  provider: string;
  /** Formatted cost string, e.g. "FREE" or "$5.00/1M" */
  costDisplay?: string;
  /** Effort levels supported by this model. Empty = effort not supported. */
  effortLevels: readonly string[];
}

interface ModelGroup {
  provider: string;
  label: string;
  models: PickerModel[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** @deprecated Use string — exported for backward compatibility only. */
export type ClaudeModelId = 'claude-opus-4-7' | 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001';

/** Effort levels for known Anthropic models. Kept for backward compatibility. */
export const MODEL_EFFORT_SUPPORT: Record<ClaudeModelId, readonly string[]> = {
  'claude-opus-4-7': ['low', 'medium', 'high', 'xhigh', 'max'],
  'claude-opus-4-6': ['low', 'medium', 'high', 'max'],
  'claude-sonnet-4-6': ['low', 'medium', 'high'],
  'claude-haiku-4-5-20251001': [],
};

/** Effort levels for all known models. Fallback when API is unavailable. */
const STATIC_EFFORT_LEVELS: Record<string, readonly string[]> = {
  ...MODEL_EFFORT_SUPPORT,
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  minimax: 'MiniMax',
  zai: 'Z.AI',
  kimi: 'Kimi',
  openrouter: 'OpenRouter',
};

/** Fallback model groups shown when the API call fails. */
const FALLBACK_GROUPS: ModelGroup[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic',
    models: [
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'anthropic', costDisplay: '$45/1M', effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', costDisplay: '$15/1M', effortLevels: ['low', 'medium', 'high'] },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic', costDisplay: '$45/1M', effortLevels: ['low', 'medium', 'high', 'max'] },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic', costDisplay: '$1/1M', effortLevels: [] },
    ],
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai', costDisplay: '$0/1M', effortLevels: [] },
      { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai', costDisplay: '$0/1M', effortLevels: [] },
    ],
  },
];

const MODEL_STORAGE_KEY = 'conv-composer-model';
export const FALLBACK_DEFAULT_MODEL = FALLBACK_DEFAULT_CONVERSATION_MODEL;

let knownModelIds = new Set(FALLBACK_GROUPS.flatMap((group) => group.models.map((model) => model.id)));

function isKnownModel(modelId: string): boolean {
  return knownModelIds.has(modelId);
}

function syncKnownModels(groups: readonly ModelGroup[]): void {
  knownModelIds = new Set(groups.flatMap((group) => group.models.map((model) => model.id)));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function loadStoredModel(resolvedDefault = getDefaultConversationModel()): string {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY);
    if (stored && isKnownModel(stored)) return stored;
  } catch {
    // Ignore
  }
  return resolvedDefault || FALLBACK_DEFAULT_MODEL;
}

export function saveStoredModel(modelId: string): void {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, modelId);
  } catch {
    // Ignore
  }
}

function formatCost(costPer1M: number): string {
  if (costPer1M === 0) return 'FREE';
  if (costPer1M < 1) return `$${costPer1M.toFixed(2)}/1M`;
  return `$${Math.round(costPer1M)}/1M`;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ModelPickerProps {
  value: string;
  onChange: (modelId: string, effortLevels: readonly string[]) => void;
  disabled?: boolean;
}

export function ModelPicker({ value, onChange, disabled = false }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<ModelGroup[]>(FALLBACK_GROUPS);
  const ref = useRef<HTMLDivElement>(null);
  const { openUp, align, maxHeight } = usePickerPosition(open, ref);

  // Fetch available models on mount so known models stay in sync with the current provider config.
  useEffect(() => {
    async function loadModels() {
      try {
        await ensureDefaultConversationModel();
        const [availRes, orRes] = await Promise.allSettled([
          fetch('/api/settings/available-models').then((r) => r.json()) as Promise<
            Record<string, Array<{ id: string; name: string; costPer1MTokens: number }>>
          >,
          fetch('/api/settings/openrouter/models').then((r) => r.json()) as Promise<{
            models: Array<{
              id: string;
              name: string;
              promptCostPer1M: number;
              supportsThinking: boolean;
            }>;
            favorites: string[];
          }>,
        ]);

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
              effortLevels: STATIC_EFFORT_LEVELS[m.id] ?? [],
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
              effortLevels: m.supportsThinking ? ['low', 'medium', 'high'] : [],
            })),
          });
        }

        if (newGroups.length > 0) {
          syncKnownModels(newGroups);
          setGroups(newGroups);
        } else {
          syncKnownModels(FALLBACK_GROUPS);
        }
      } catch {
        syncKnownModels(FALLBACK_GROUPS);
      }
    }
    void loadModels();
  }, []);

  // Find selected model across all groups
  const allModels = groups.flatMap((g) => g.models);
  const selectedModel = allModels.find((m) => m.id === value);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleSelect(model: PickerModel) {
    onChange(model.id, model.effortLevels);
    localStorage.setItem(MODEL_STORAGE_KEY, model.id);
    setOpen(false);
  }

  const label = selectedModel?.label ?? value;

  return (
    <div ref={ref} className={styles.pickerContainer}>
      <button
        className={styles.pickerBtn}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        type="button"
      >
        <span className={styles.pickerLabel}>{label}</span>
        <ChevronDown size={11} />
      </button>

      {open && (
        <div
          className={`${styles.pickerDropdown} ${openUp ? styles.pickerDropdownUp : ''}`}
          style={{
            maxHeight: `${maxHeight}px`,
            ...(align === 'right' ? { left: 'auto', right: 0 } : {}),
          }}
        >
          {groups.map((group) => (
            <div key={group.provider}>
              {groups.length > 1 && (
                <div className={styles.pickerGroupHeader}>{group.label}</div>
              )}
              {group.models.map((model) => (
                <button
                  key={model.id}
                  className={`${styles.pickerOption} ${model.id === value ? styles.pickerOptionActive : ''}`}
                  onClick={() => handleSelect(model)}
                  type="button"
                >
                  <span className={styles.pickerOptionLabel}>{model.label}</span>
                  {model.costDisplay && (
                    <span className={styles.pickerCostBadge}>{model.costDisplay}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
