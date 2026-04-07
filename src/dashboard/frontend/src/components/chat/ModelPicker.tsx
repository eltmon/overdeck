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
import styles from '../MissionControl/styles/mission-control.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClaudeAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  expired: boolean;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  expiresAt: number | null;
  hasAnthropicApiKey: boolean;
}

interface PickerModel {
  id: string;
  label: string;
  provider: string;
  /** Formatted cost string, e.g. "FREE" or "$5.00/1M" */
  costDisplay?: string;
  /** Effort levels supported by this model. Empty = effort not supported. */
  effortLevels: readonly string[];
  /**
   * For Anthropic models:
   *   "sub"   — available via active subscription (MAX / Pro)
   *   "key"   — requires ANTHROPIC_API_KEY
   *   "noauth" — no subscription and no key configured
   */
  authMode?: 'sub' | 'key' | 'noauth';
  /** Short label shown in the badge, e.g. "MAX", "Pro", "API Key" */
  authBadge?: string;
}

interface ModelGroup {
  provider: string;
  label: string;
  models: PickerModel[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** @deprecated Use string — exported for backward compatibility only. */
export type ClaudeModelId = 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001';

/** Effort levels for known Anthropic models. Kept for backward compatibility. */
export const MODEL_EFFORT_SUPPORT: Record<ClaudeModelId, readonly string[]> = {
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
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic', costDisplay: '$45/1M', effortLevels: ['low', 'medium', 'high', 'max'] },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', costDisplay: '$15/1M', effortLevels: ['low', 'medium', 'high'] },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic', costDisplay: '$1/1M', effortLevels: [] },
    ],
  },
];

const MODEL_STORAGE_KEY = 'conv-composer-model';
const DEFAULT_MODEL = 'claude-opus-4-6';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function loadStoredModel(): string {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // Ignore
  }
  return DEFAULT_MODEL;
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

  // Fetch available models from the API on mount
  useEffect(() => {
    async function loadModels() {
      try {
        const [availRes, orRes, authRes] = await Promise.allSettled([
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
          fetch('/api/settings/claude-auth').then((r) => r.json()) as Promise<ClaudeAuthStatus>,
        ]);

        const avail = availRes.status === 'fulfilled' ? availRes.value : {};
        const orData = orRes.status === 'fulfilled' ? orRes.value : { models: [], favorites: [] };
        const auth = authRes.status === 'fulfilled' ? authRes.value : null;

        // Determine Anthropic auth mode for badge display
        let anthropicAuthMode: PickerModel['authMode'] = 'noauth';
        let anthropicBadge: string | undefined;
        if (auth?.loggedIn && auth.subscriptionType) {
          anthropicAuthMode = 'sub';
          anthropicBadge = auth.subscriptionType.toUpperCase(); // "MAX" or "PRO"
        } else if (auth?.hasAnthropicApiKey) {
          anthropicAuthMode = 'key';
          anthropicBadge = undefined; // already have cost display
        }

        const newGroups: ModelGroup[] = [];

        // Static providers (excluding openrouter — handled separately)
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
              costDisplay: prov === 'anthropic' && anthropicAuthMode === 'sub'
                ? undefined  // subscription — no per-token cost shown
                : formatCost(m.costPer1MTokens),
              effortLevels: STATIC_EFFORT_LEVELS[m.id] ?? [],
              authMode: prov === 'anthropic' ? anthropicAuthMode : undefined,
              authBadge: prov === 'anthropic' ? anthropicBadge : undefined,
            })),
          });
        }

        // OpenRouter favorites
        const orFavorites: string[] = orData.favorites ?? [];
        const orFavoriteModels = (orData.models ?? []).filter((m) =>
          orFavorites.includes(m.id),
        );
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
          setGroups(newGroups);
        }
      } catch {
        // Keep fallback groups on error
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
  // Append plan badge to trigger button label for subscribed Anthropic models
  const triggerBadge = selectedModel?.authBadge ?? null;

  return (
    <div ref={ref} className={styles.pickerContainer}>
      <button
        className={styles.pickerBtn}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        type="button"
      >
        <span className={styles.pickerLabel}>{label}</span>
        {triggerBadge && (
          <span className={styles.pickerAuthBadge}>{triggerBadge}</span>
        )}
        <ChevronDown size={11} />
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
                  className={`${styles.pickerOption} ${model.id === value ? styles.pickerOptionActive : ''}`}
                  onClick={() => handleSelect(model)}
                  type="button"
                >
                  <span className={styles.pickerOptionLabel}>{model.label}</span>
                  {model.authBadge && (
                    <span className={styles.pickerAuthBadge}>{model.authBadge}</span>
                  )}
                  {model.authMode === 'noauth' && !model.authBadge && (
                    <span className={styles.pickerAuthBadgeWarn}>No key</span>
                  )}
                  {!model.authBadge && model.authMode !== 'noauth' && model.costDisplay && (
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
