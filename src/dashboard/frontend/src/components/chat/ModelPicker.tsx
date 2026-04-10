/**
 * ModelPicker (PAN-479)
 *
 * Dropdown for selecting the model to use in a conversation.
 * Fetches available models from all enabled providers (including OpenRouter favorites).
 * Groups by provider, shows per-model cost, and exposes effort level support.
 * Selection is persisted to localStorage.
 */

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from '../MissionControl/styles/mission-control.module.css';

// ─── Provider icons ───────────────────────────────────────────────────────────

function ClaudeIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} preserveAspectRatio="xMidYMid" viewBox="0 0 256 257" fill="currentColor" aria-hidden="true">
      <path d="m50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z" />
    </svg>
  );
}

/** Returns the provider icon element for a given provider string, or null. */
function ProviderIcon({ provider, className, style }: { provider: string; className?: string; style?: React.CSSProperties }) {
  if (provider === 'anthropic') {
    return <ClaudeIcon className={className} style={style} />;
  }
  return null;
}


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
  /** True if this provider has credentials configured and is usable */
  usable: boolean;
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
  kimi: 'Kimi',
  minimax: 'MiniMax',
  openrouter: 'OpenRouter',
};

/** Fallback model groups shown when the API call fails. */
const FALLBACK_GROUPS: ModelGroup[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic',
    usable: true, // optimistic — assume authed if we can't check
    models: [
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic', costDisplay: '$45/1M', effortLevels: ['low', 'medium', 'high', 'max'] },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', costDisplay: '$15/1M', effortLevels: ['low', 'medium', 'high'] },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic', costDisplay: '$1/1M', effortLevels: [] },
    ],
  },
];

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

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

  // Fetch available models + auth status on mount
  useEffect(() => {
    async function loadModels() {
      try {
        const [availRes, orRes, authRes] = await Promise.allSettled([
          fetch('/api/settings/available-models').then((r) => r.json()) as Promise<
            Record<string, Array<{ id: string; name: string; costPer1MTokens: number }>> & {
              usable?: Record<string, boolean>;
            }
          >,
          fetch('/api/settings/openrouter/models').then((r) => r.json()) as Promise<{
            models: Array<{ id: string; name: string; promptCostPer1M: number; supportsThinking: boolean }>;
            favorites: string[];
          }>,
          fetch('/api/settings/claude-auth').then((r) => r.json()) as Promise<ClaudeAuthStatus>,
        ]);

        const avail = availRes.status === 'fulfilled' ? availRes.value : {};
        const usable: Record<string, boolean> = (avail as any).usable ?? {};
        const orData = orRes.status === 'fulfilled' ? orRes.value : { models: [], favorites: [] };
        const auth = authRes.status === 'fulfilled' ? authRes.value : null;

        // Anthropic auth mode — server already checked credentials; reflect it via usable.anthropic
        const anthropicUsable = usable.anthropic ?? false;
        let anthropicAuthMode: PickerModel['authMode'] = anthropicUsable ? 'key' : 'noauth';
        let anthropicBadge: string | undefined;
        if (auth?.loggedIn && auth.subscriptionType) {
          anthropicAuthMode = 'sub';
          anthropicBadge = auth.subscriptionType.toUpperCase();
        } else if (auth?.hasAnthropicApiKey) {
          anthropicAuthMode = 'key';
        }

        const newGroups: ModelGroup[] = [];

        // Build provider groups — all providers shown, but `usable` flag drives UI treatment
        for (const [prov, models] of Object.entries(avail)) {
          if (prov === 'openrouter' || prov === 'usable') continue;
          if (!Array.isArray(models) || models.length === 0) continue;
          const provUsable = prov === 'anthropic' ? anthropicUsable : (usable[prov] ?? false);
          newGroups.push({
            provider: prov,
            label: PROVIDER_LABELS[prov] ?? prov,
            usable: provUsable,
            models: models.map((m) => ({
              id: m.id,
              label: m.name,
              provider: prov,
              costDisplay: prov === 'anthropic' && anthropicAuthMode === 'sub'
                ? undefined
                : formatCost(m.costPer1MTokens),
              effortLevels: STATIC_EFFORT_LEVELS[m.id] ?? [],
              authMode: prov === 'anthropic' ? anthropicAuthMode : undefined,
              authBadge: prov === 'anthropic' ? anthropicBadge : undefined,
            })),
          });
        }

        // OpenRouter favorites (always usable if they appear — key already validated)
        const orFavorites: string[] = orData.favorites ?? [];
        const orFavoriteModels = (orData.models ?? []).filter((m) => orFavorites.includes(m.id));
        if (orFavoriteModels.length > 0) {
          newGroups.push({
            provider: 'openrouter',
            label: 'OpenRouter',
            usable: usable.openrouter ?? false,
            models: orFavoriteModels.map((m) => ({
              id: m.id,
              label: m.name,
              provider: 'openrouter',
              costDisplay: formatCost(m.promptCostPer1M),
              effortLevels: m.supportsThinking ? ['low', 'medium', 'high'] : [],
            })),
          });
        }

        // Auto-select: switch away from unusable provider models
        if (newGroups.length > 0) {
          setGroups(newGroups);
          const currentProvider = newGroups.flatMap(g => g.models).find(m => m.id === value)?.provider;
          const currentGroupUsable = newGroups.find(g => g.provider === currentProvider)?.usable ?? true;
          if (!currentGroupUsable) {
            const firstUsableGroup = newGroups.find(g => g.usable && g.models.length > 0);
            if (firstUsableGroup) {
              const firstModel = firstUsableGroup.models[0]!;
              onChange(firstModel.id, firstModel.effortLevels);
            }
          }
        }
      } catch {
        // Keep fallback groups on error
      }
    }
    void loadModels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setOpen(false);
  }

  const label = selectedModel?.label ?? value;
  const triggerBadge = selectedModel?.authBadge ?? null;
  const selectedProvider = selectedModel?.provider ?? '';

  const [dropdownPos, setDropdownPos] = useState({ x: 0, y: 0 });

  return (
    <div ref={ref} className={styles.pickerContainer}>
      <button
        className={styles.pickerBtn}
        onClick={(e) => {
          if (!open) {
            const rect = e.currentTarget.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;
            const dropdownHeight = 400; // approximate max height with scroll
            const dropdownWidth = 280; // min-width from CSS

            // Open upward if there's room above; otherwise open downward
            const openUpward = rect.top >= dropdownHeight;
            let y = openUpward ? rect.top - 4 : rect.bottom + 4;

            // Constrain y to stay within viewport
            y = Math.max(8, Math.min(y, viewportHeight - dropdownHeight - 8));

            // Constrain x to stay within viewport width
            let x = rect.left;
            x = Math.max(8, Math.min(x, viewportWidth - dropdownWidth - 8));

            setDropdownPos({ x, y });
          }
          setOpen((o) => !o);
        }}
        disabled={disabled}
        type="button"
      >
        <ProviderIcon
          provider={selectedProvider}
          className={styles.pickerProviderIcon}
          // Orange for Anthropic, inherits muted color otherwise
          style={selectedProvider === 'anthropic' ? { color: '#d97757' } : undefined}
        />
        <span className={styles.pickerLabel}>{label}</span>
        {triggerBadge && (
          <span className={styles.pickerAuthBadge}>{triggerBadge}</span>
        )}
        <ChevronDown size={10} />
      </button>

      {open && (
        <div className={styles.pickerDropdown} style={{ left: dropdownPos.x, top: dropdownPos.y }}>
          {groups.map((group) => (
            <div key={group.provider} className={!group.usable ? styles.pickerGroupDisabled : undefined}>
              {groups.length > 1 && (
                <div className={styles.pickerGroupHeader}>
                  {group.label}
                  {!group.usable && <span className={styles.pickerGroupNoKey}>No Key</span>}
                </div>
              )}
              {group.models.map((model) => (
                <button
                  key={model.id}
                  className={`${styles.pickerOption} ${model.id === value ? styles.pickerOptionActive : ''}`}
                  onClick={() => handleSelect(model)}
                  type="button"
                >
                  <span className={styles.pickerOptionLabel}>{model.label}</span>
                  {model.authBadge && group.usable && (
                    <span className={styles.pickerAuthBadge}>{model.authBadge}</span>
                  )}
                  {model.costDisplay && group.usable && !model.authBadge && (
                    <span className={styles.pickerCostBadge}>{model.costDisplay}</span>
                  )}
                  {model.costDisplay && !group.usable && (
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
