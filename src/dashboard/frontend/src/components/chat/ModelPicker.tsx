/**
 * ModelPicker (PAN-479)
 *
 * Two-panel dropdown for selecting the model + harness combination.
 * Left sidebar: AI provider filter (Anthropic, OpenAI, …).
 * Right panel: pinned harness selector → search bar → scrollable model list.
 * Selection is persisted to localStorage.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Lock, Search, LayoutGrid } from 'lucide-react';
import {
  FALLBACK_DEFAULT_CONVERSATION_MODEL,
  getDefaultConversationModel,
  ensureDefaultConversationModel,
} from './defaultConversationModel';
import { usePickerPosition } from './usePickerPosition';
import { CostWarningBadge, costWarningLevel } from '../shared/costWarning';
import { HARNESS_OPTIONS, canUsePickerHarness, type HarnessPolicyDecisions } from '../shared/ModelPicker';
import type { Harness } from '../shared/ModelPicker';
import { ProviderIcon, ProviderDot } from './ProviderIcons';
import styles from '../CommandDeck/styles/command-deck.module.css';

export type { Harness } from '../shared/ModelPicker';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PickerModel {
  id: string;
  label: string;
  provider: string;
  costDisplay?: string;
  costPer1MTokens?: number;
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
  mimo: 'Xiaomi MiMo',
  openrouter: 'OpenRouter',
};

const FALLBACK_GROUPS: ModelGroup[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic',
    models: [
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'anthropic', costDisplay: '$45/1M', costPer1MTokens: 45, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', costDisplay: '$15/1M', costPer1MTokens: 15, effortLevels: ['low', 'medium', 'high'] },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic', costDisplay: '$45/1M', costPer1MTokens: 45, effortLevels: ['low', 'medium', 'high', 'max'] },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic', costDisplay: '$1/1M', costPer1MTokens: 1, effortLevels: [] },
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
const HARNESS_STORAGE_KEY = 'conv-composer-harness';
export const FALLBACK_DEFAULT_MODEL = FALLBACK_DEFAULT_CONVERSATION_MODEL;

let knownModelIds = new Set(FALLBACK_GROUPS.flatMap((g) => g.models.map((m) => m.id)));

function isKnownModel(modelId: string): boolean {
  return knownModelIds.has(modelId);
}

function syncKnownModels(groups: readonly ModelGroup[]): void {
  knownModelIds = new Set(groups.flatMap((g) => g.models.map((m) => m.id)));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function loadStoredModel(resolvedDefault = getDefaultConversationModel()): string {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY);
    if (stored && isKnownModel(stored)) return stored;
  } catch { /* ignore */ }
  return resolvedDefault || FALLBACK_DEFAULT_MODEL;
}

export function saveStoredModel(modelId: string): void {
  try { localStorage.setItem(MODEL_STORAGE_KEY, modelId); } catch { /* ignore */ }
}

export function loadStoredHarness(): Harness {
  try {
    const stored = localStorage.getItem(HARNESS_STORAGE_KEY);
    if (stored === 'pi' || stored === 'claude-code') return stored;
  } catch { /* ignore */ }
  return 'claude-code';
}

export function saveStoredHarness(harness: Harness): void {
  try { localStorage.setItem(HARNESS_STORAGE_KEY, harness); } catch { /* ignore */ }
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
  harness?: Harness;
  onHarnessChange?: (harness: Harness) => void;
}

export function ModelPicker({ value, onChange, disabled = false, harness, onHarnessChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<ModelGroup[]>(FALLBACK_GROUPS);
  const [harnessPolicy, setHarnessPolicy] = useState<HarnessPolicyDecisions>({});
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { openUp, align, maxHeight } = usePickerPosition(open, ref);

  // Reset search when dropdown closes
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  // Fetch available models on mount
  useEffect(() => {
    async function loadModels() {
      try {
        await ensureDefaultConversationModel();
        const [availRes, orRes] = await Promise.allSettled([
          fetch('/api/settings/available-models').then((r) => r.json()) as Promise<
            Record<string, Array<{ id: string; name: string; costPer1MTokens: number }>>
          >,
          fetch('/api/settings/openrouter/models').then((r) => r.json()) as Promise<{
            models: Array<{ id: string; name: string; promptCostPer1M: number; supportsThinking: boolean }>;
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
              costPer1MTokens: m.costPer1MTokens,
              effortLevels: STATIC_EFFORT_LEVELS[m.id] ?? [],
            })),
          });
        }

        const orFavorites = new Set(orData.favorites ?? []);
        const orFavoriteModels = (orData.models ?? []).filter((m) => orFavorites.has(m.id));
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
              effortLevels: m.supportsThinking ? ['low', 'medium', 'high'] : [],
            })),
          });
        }

        const effectiveGroups = newGroups.length > 0 ? newGroups : FALLBACK_GROUPS;
        syncKnownModels(effectiveGroups);
        if (newGroups.length > 0) setGroups(newGroups);

        const modelIds = effectiveGroups.flatMap((g) => g.models.map((m) => m.id));
        if (modelIds.length > 0) {
          const policy = await fetch(`/api/settings/harness-policy?models=${encodeURIComponent(modelIds.join(','))}`)
            .then((r) => r.json()) as { decisions?: HarnessPolicyDecisions };
          setHarnessPolicy(policy.decisions ?? {});
        }
      } catch {
        syncKnownModels(FALLBACK_GROUPS);
      }
    }
    void loadModels();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Filtered model groups — respects both provider filter and search query
  const filteredGroups = useMemo(() => {
    let result = groups;
    if (providerFilter !== null) {
      result = result.filter((g) => g.provider === providerFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result
        .map((g) => ({ ...g, models: g.models.filter((m) => m.label.toLowerCase().includes(q)) }))
        .filter((g) => g.models.length > 0);
    }
    return result;
  }, [groups, providerFilter, search]);

  const allModels = groups.flatMap((g) => g.models);
  const selectedModel = allModels.find((m) => m.id === value);
  const selectedWarning = costWarningLevel(selectedModel?.costPer1MTokens);

  // Show provider sidebar when there are multiple AI providers
  const showProviderSidebar = groups.length > 1;
  // Show provider subtitle on model rows when multiple providers are visible
  const showProviderSubtitle = filteredGroups.length > 1;
  // Show group headers when multiple providers are in view
  const showGroupHeaders = filteredGroups.length > 1;

  function handleSelect(model: PickerModel) {
    onChange(model.id, model.effortLevels);
    localStorage.setItem(MODEL_STORAGE_KEY, model.id);
    setOpen(false);
  }

  const label = selectedModel?.label ?? value;

  return (
    <div ref={ref} className={styles.pickerContainer}>
      {/* ── Trigger button ── */}
      <button
        className={styles.pickerBtn}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        type="button"
      >
        {selectedModel && (
          <ProviderIcon
            provider={selectedModel.provider}
            label={PROVIDER_LABELS[selectedModel.provider] ?? selectedModel.provider}
            className={styles.pickerProviderIcon}
          />
        )}
        <span className={styles.pickerLabel}>{label}</span>
        {harness === 'pi' && (
          <span className={styles.harnessIndicator} title="Pi harness active">Pi</span>
        )}
        {selectedWarning && (
          <CostWarningBadge level={selectedWarning} compact costPer1MTokens={selectedModel?.costPer1MTokens} />
        )}
        <ChevronDown size={11} />
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div
          className={`${styles.pickerDropdown} ${openUp ? styles.pickerDropdownUp : ''}`}
          style={{
            maxHeight: `${maxHeight}px`,
            ...(align === 'right' ? { left: 'auto', right: 0 } : {}),
          }}
        >
          {/* Provider filter sidebar */}
          {showProviderSidebar && (
            <div className={styles.pickerProviderSidebar}>
              <button
                type="button"
                className={`${styles.pickerProviderBtn} ${providerFilter === null ? styles.pickerProviderBtnActive : ''}`}
                onClick={() => setProviderFilter(null)}
                title="All providers"
              >
                <LayoutGrid size={13} />
              </button>
              {groups.map((group) => (
                <button
                  key={group.provider}
                  type="button"
                  className={`${styles.pickerProviderBtn} ${providerFilter === group.provider ? styles.pickerProviderBtnActive : ''}`}
                  onClick={() => setProviderFilter(group.provider)}
                  title={group.label}
                >
                  <ProviderIcon
                    provider={group.provider}
                    label={group.label}
                    className={styles.pickerProviderBtnIcon}
                  />
                </button>
              ))}
            </div>
          )}

          {/* Main panel */}
          <div className={styles.pickerMainPanel}>
            {/* Harness section — pinned above search, scales to many harnesses */}
            {harness !== undefined && onHarnessChange && (
              <>
                <div className={`${styles.pickerGroupHeader} ${styles.pickerHarnessHeader}`}>Harness</div>
                {HARNESS_OPTIONS.map((opt: { id: Harness; label: string; description: string }) => {
                  const decision = canUsePickerHarness(opt.id, value, harnessPolicy);
                  const isActive = harness === opt.id;
                  const isLocked = !decision.allowed;
                  const subtitle = isLocked && decision.reason ? decision.reason : opt.description;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`${styles.harnessOption} ${isActive ? styles.harnessOptionActive : ''} ${isLocked ? styles.harnessOptionLocked : ''}`}
                      disabled={isLocked}
                      onClick={() => { if (!isLocked) onHarnessChange(opt.id); }}
                    >
                      <span className={styles.harnessOptionIcon}>
                        {isActive ? <Check size={11} /> : isLocked ? <Lock size={11} /> : null}
                      </span>
                      <span className={styles.harnessOptionBody}>
                        <span className={styles.harnessOptionName}>{opt.label}</span>
                        {subtitle && <span className={styles.harnessOptionDesc}>{subtitle}</span>}
                      </span>
                    </button>
                  );
                })}
                <div className={styles.pickerSectionDivider} />
              </>
            )}

            {/* Search bar */}
            <div className={styles.pickerSearchWrapper}>
              <Search size={11} className={styles.pickerSearchIcon} />
              <input
                type="text"
                className={styles.pickerSearchInput}
                placeholder="Search models…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                autoFocus
              />
            </div>

            {/* Scrollable model list */}
            <div className={styles.pickerScrollContent}>
              {filteredGroups.length > 0 ? (
                filteredGroups.map((group) => (
                  <div key={group.provider}>
                    {showGroupHeaders && (
                      <div className={styles.pickerGroupHeader}>{group.label}</div>
                    )}
                    {group.models.map((model) => {
                      const lvl = costWarningLevel(model.costPer1MTokens);
                      return (
                        <button
                          key={model.id}
                          className={`${styles.pickerOption} ${model.id === value ? styles.pickerOptionActive : ''}`}
                          onClick={() => handleSelect(model)}
                          type="button"
                        >
                          <span className={styles.pickerOptionContent}>
                            <span className={styles.pickerOptionRow}>
                              <span className={styles.pickerOptionLabel}>{model.label}</span>
                              {lvl && <CostWarningBadge level={lvl} compact costPer1MTokens={model.costPer1MTokens} />}
                              {model.costDisplay && (
                                <span className={styles.pickerCostBadge}>{model.costDisplay}</span>
                              )}
                            </span>
                            {showProviderSubtitle && (
                              <span className={styles.pickerOptionSubtitle}>
                                <ProviderDot provider={model.provider} />
                                {PROVIDER_LABELS[model.provider] ?? model.provider}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))
              ) : (
                <div className={styles.pickerNoResults}>
                  No models match &ldquo;{search}&rdquo;
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
