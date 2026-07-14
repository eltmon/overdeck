import { useEffect, useState } from 'react';
import { Route } from 'lucide-react';
import { type Harness, type SettingsConfig, type TieredExecutionConfig } from '../types';
import type { SaveStatus } from '../hooks/useAutosavePipeline';
import { MODELS_BY_PROVIDER } from '../modelCatalog';

interface TieredExecutionSectionProps {
  formData: SettingsConfig;
  saveErrorMessage?: string | null;
  saveStatus?: SaveStatus;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

const DIFFICULTIES = ['trivial', 'simple', 'medium', 'complex', 'expert'] as const;
const ITEM_KINDS = ['docs', 'api', 'backend', 'frontend', 'infra', 'test', 'refactor', 'design', 'spike'] as const;
const HARNESSES: Harness[] = ['claude-code', 'ohmypi', 'codex'];
const SUBSCRIPTIONS = ['all', 'flagged', 'sampled'] as const;
const CALLOUTS = ['off', 'notify', 'corroborate'] as const;
const MODEL_OPTIONS = Object.entries(MODELS_BY_PROVIDER).flatMap(([providerId, provider]) =>
  provider.models.map((model) => ({
    providerId,
    providerName: provider.name,
    id: model.id,
    name: model.name,
  })),
);
// Defaults must NEVER be a frontier model (fable/opus). MODEL_OPTIONS[0] is
// the most premium catalog entry, and defaulting new tiers/the supervisor to
// it silently burned the operator's Anthropic plan (2026-07-05 incident).
// Frontier models stay fully selectable — they are just never the unchosen
// default. Enforced by __tests__/TieredExecutionSection.test.tsx.
export const DEFAULT_MODEL = 'claude-haiku-4-5';
export const DEFAULT_SUPERVISOR_MODEL = 'claude-sonnet-5';

function defaultTieredExecution(enabled: boolean): TieredExecutionConfig {
  return {
    enabled,
    tiers: {},
    by_kind: {},
    feed: { callouts: 'off', exclude: [], exclude_subjects: [], max_diff_bytes: null },
    escalation: { enabled: false, retries_at_tier: 0, max_promotions: 0, flounder_budget_minutes: {} },
    compaction_reroute: 'off',
    replay_threshold: 0.5,
  };
}

function csvToList(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function listToCsv(value: string[] | undefined): string {
  return (value ?? []).join(', ');
}

function validationReason(config: TieredExecutionConfig | undefined): string | null {
  if (!config) return null;
  const tiers = Object.entries(config.tiers ?? {});
  const shouldValidateTierTable = config.enabled || tiers.length > 0 || Object.keys(config.by_kind ?? {}).length > 0 || config.supervisor !== undefined;
  if (typeof config.replay_threshold !== 'number' || config.replay_threshold <= 0 || config.replay_threshold > 1) {
    return 'tiered_execution.replay_threshold must be a number > 0 and <= 1';
  }
  if (!shouldValidateTierTable) return null;

  const owners = new Map<string, string[]>();
  for (const [tierName, tier] of tiers) {
    if (tier.distribution) {
      if (tier.distribution.length === 0) return `tiered_execution.tiers.${tierName}.distribution must be a non-empty array`;
      const total = tier.distribution.reduce((sum, entry) => sum + (entry.weight || 0), 0);
      if (total !== 100) return `tiered_execution.tiers.${tierName}.distribution weights must total exactly 100 (got ${total})`;
    }
    if (!tier.model) return `tiered_execution.tiers.${tierName}.model is required`;
    if (!tier.harness) return `tiered_execution.tiers.${tierName}.harness is required`;
    if (!Array.isArray(tier.difficulties) || tier.difficulties.length === 0) {
      return `tiered_execution.tiers.${tierName}.difficulties must contain at least one difficulty`;
    }
    for (const difficulty of tier.difficulties) {
      owners.set(difficulty, [...(owners.get(difficulty) ?? []), tierName]);
    }
  }

  for (const difficulty of DIFFICULTIES) {
    const mapped = owners.get(difficulty) ?? [];
    if (mapped.length === 0) return `tiered_execution difficulty '${difficulty}' is not mapped to any tier`;
    if (mapped.length > 1) return `tiered_execution difficulty '${difficulty}' is mapped to multiple tiers: ${mapped.join(', ')}`;
  }

  for (const [kind, tierName] of Object.entries(config.by_kind ?? {})) {
    if (tierName && !config.tiers[tierName]) return `tiered_execution.by_kind.${kind} references unknown tier '${tierName}'`;
  }

  if (!config.supervisor) return 'tiered_execution.supervisor is required when tiered execution tiers are configured';
  return null;
}

function inputDifficultyMap(config: TieredExecutionConfig | undefined): Partial<Record<typeof DIFFICULTIES[number], string>> {
  const result: Partial<Record<typeof DIFFICULTIES[number], string>> = {};
  for (const [tierName, tier] of Object.entries(config?.tiers ?? {})) {
    for (const difficulty of tier.difficulties ?? []) {
      if (DIFFICULTIES.includes(difficulty)) result[difficulty] = result[difficulty] ? 'multiple' : tierName;
    }
  }
  return result;
}

function nextTierName(config: TieredExecutionConfig | undefined): string {
  const existing = new Set(Object.keys(config?.tiers ?? {}));
  let index = existing.size + 1;
  while (existing.has(`tier-${index}`)) index += 1;
  return `tier-${index}`;
}

function TierNameInput({
  name,
  tierNames,
  onRename,
}: {
  name: string;
  tierNames: string[];
  onRename: (oldName: string, newName: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(name);
    setError(null);
  }, [name]);

  const commit = () => {
    const nextName = draft.trim();
    if (!nextName || nextName === name) {
      setDraft(name);
      setError(null);
      return;
    }
    if (tierNames.includes(nextName)) {
      setError('Tier name already exists');
      return;
    }
    setError(null);
    onRename(name, nextName);
  };

  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-foreground">Tier name</span>
      <input
        type="text"
        value={draft}
        onBlur={commit}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(name);
            setError(null);
            event.currentTarget.blur();
          }
        }}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono text-foreground focus:ring-1 focus:ring-primary"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </label>
  );
}

export function TieredExecutionSection({
  formData,
  saveErrorMessage,
  saveStatus = 'idle',
  onSettingsChange,
}: TieredExecutionSectionProps) {
  const config = formData.tiered_execution;
  const tiers = Object.entries(config?.tiers ?? {});
  const difficultyMap = inputDifficultyMap(config);
  const byKind = config?.by_kind ?? config?.byKind ?? {};
  const reason = validationReason(config);
  const enabled = config?.enabled ?? false;
  const resolvedState = enabled && !reason ? 'Enabled' : reason ? 'Invalid' : 'Disabled';
  const serverTieredError = saveErrorMessage?.includes('tiered_execution') ? saveErrorMessage : null;
  const difficultyError = serverTieredError?.includes('tiered_execution difficulty') ? serverTieredError : null;
  const supervisorError = serverTieredError?.includes('tiered_execution.supervisor') || reason?.includes('tiered_execution.supervisor')
    ? serverTieredError ?? reason
    : null;
  const byKindError = serverTieredError?.includes('tiered_execution.by_kind') || reason?.includes('tiered_execution.by_kind')
    ? serverTieredError ?? reason
    : null;
  const feedError = serverTieredError?.includes('tiered_execution.feed') ? serverTieredError : null;
  const escalationError = serverTieredError?.includes('tiered_execution.escalation') ? serverTieredError : null;
  const replayThresholdError = serverTieredError?.includes('tiered_execution.replay_threshold') || reason?.includes('tiered_execution.replay_threshold')
    ? serverTieredError ?? reason
    : null;
  const tierNames = Object.keys(config?.tiers ?? {});

  const updateTieredExecution = (nextConfig: TieredExecutionConfig) => {
    onSettingsChange({
      ...formData,
      tiered_execution: nextConfig,
    });
  };

  const currentConfig = (): TieredExecutionConfig => ({
    ...defaultTieredExecution(enabled),
    ...config,
    tiers: { ...(config?.tiers ?? {}) },
  });

  const handleEnabledChange = () => {
    updateTieredExecution({
      ...defaultTieredExecution(!enabled),
      ...config,
      enabled: !enabled,
    });
  };

  const handleAddTier = () => {
    const next = currentConfig();
    const name = nextTierName(next);
    updateTieredExecution({
      ...next,
      tiers: {
        ...next.tiers,
        [name]: {
          model: DEFAULT_MODEL,
          harness: 'claude-code',
          difficulties: [],
        },
      },
    });
  };

  const handleRenameTier = (oldName: string, newName: string) => {
    if (!newName || newName === oldName) return;
    const next = currentConfig();
    if (next.tiers[newName]) return;
    const { [oldName]: tier, ...rest } = next.tiers;
    if (!tier) return;
    updateTieredExecution({
      ...next,
      tiers: {
        ...rest,
        [newName]: tier,
      },
    });
  };

  const handleTierPatch = (
    name: string,
    patch: Partial<TieredExecutionConfig['tiers'][string]>,
  ) => {
    const next = currentConfig();
    const tier = next.tiers[name];
    if (!tier) return;
    updateTieredExecution({
      ...next,
      tiers: {
        ...next.tiers,
        [name]: {
          ...tier,
          ...patch,
        },
      },
    });
  };

  const handleDifficultyToggle = (name: string, difficulty: typeof DIFFICULTIES[number]) => {
    const tier = config?.tiers?.[name];
    if (!tier) return;
    const difficulties = tier.difficulties.includes(difficulty)
      ? tier.difficulties.filter((entry) => entry !== difficulty)
      : [...tier.difficulties, difficulty];
    handleTierPatch(name, { difficulties });
  };

  type DistributionEntry = { model: string; harness: Harness; weight: number };

  const representativeOf = (entries: DistributionEntry[]): { model: string; harness: Harness } => {
    const top = entries.reduce((best, entry) => (entry.weight > best.weight ? entry : best));
    return { model: top.model, harness: top.harness };
  };

  const handleToggleDistribution = (name: string) => {
    const tier = config?.tiers?.[name];
    if (!tier) return;
    if (tier.distribution) {
      const { model, harness } = representativeOf(tier.distribution as DistributionEntry[]);
      handleTierPatch(name, { model, harness, distribution: undefined } as never);
    } else {
      handleTierPatch(name, {
        distribution: [{ model: tier.model, harness: tier.harness, weight: 100 }],
      } as never);
    }
  };

  const handleDistributionPatch = (name: string, index: number, patch: Partial<DistributionEntry>) => {
    const tier = config?.tiers?.[name];
    const entries = (tier?.distribution ?? []) as DistributionEntry[];
    const next = entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
    // Keep model/harness = the max-weight representative so save/load
    // round-trips stay idempotent with the server validator.
    handleTierPatch(name, { distribution: next, ...representativeOf(next) } as never);
  };

  const handleDistributionAdd = (name: string) => {
    const tier = config?.tiers?.[name];
    if (!tier) return;
    const entries = (tier.distribution ?? []) as DistributionEntry[];
    const next = [...entries, { model: tier.model, harness: tier.harness, weight: 0 } as DistributionEntry];
    handleTierPatch(name, { distribution: next, ...representativeOf(next) } as never);
  };

  const handleDistributionRemove = (name: string, index: number) => {
    const tier = config?.tiers?.[name];
    const entries = (tier?.distribution ?? []) as DistributionEntry[];
    if (entries.length <= 1) return handleToggleDistribution(name);
    const next = entries.filter((_, i) => i !== index);
    handleTierPatch(name, { distribution: next, ...representativeOf(next) } as never);
  };

  const handleRemoveTier = (name: string) => {
    const next = currentConfig();
    const { [name]: _removed, ...tiersWithoutRemoved } = next.tiers;
    updateTieredExecution({
      ...next,
      tiers: tiersWithoutRemoved,
    });
  };

  const handleSupervisorPatch = (patch: Partial<NonNullable<TieredExecutionConfig['supervisor']>>) => {
    const next = currentConfig();
    updateTieredExecution({
      ...next,
      supervisor: {
        model: next.supervisor?.model ?? DEFAULT_SUPERVISOR_MODEL,
        harness: next.supervisor?.harness ?? 'claude-code',
        subscribe: next.supervisor?.subscribe ?? 'flagged',
        owns_inspection: next.supervisor?.owns_inspection ?? false,
        ...patch,
      },
    });
  };

  const handleByKindChange = (kind: typeof ITEM_KINDS[number], tierName: string) => {
    const next = currentConfig();
    const byKind = { ...(next.by_kind ?? {}) };
    if (tierName) byKind[kind] = tierName;
    else delete byKind[kind];
    updateTieredExecution({
      ...next,
      by_kind: byKind,
    });
  };

  const handleFeedPatch = (patch: Partial<NonNullable<TieredExecutionConfig['feed']>>, opts: { debounce?: boolean } = {}) => {
    const next = currentConfig();
    onSettingsChange({
      ...formData,
      tiered_execution: {
        ...next,
        feed: {
          callouts: next.feed?.callouts ?? 'off',
          exclude: next.feed?.exclude ?? [],
          exclude_subjects: next.feed?.exclude_subjects ?? [],
          max_diff_bytes: next.feed?.max_diff_bytes ?? null,
          ...patch,
        },
      },
    }, opts);
  };

  const handleEscalationPatch = (patch: Partial<NonNullable<TieredExecutionConfig['escalation']>>, opts: { debounce?: boolean } = {}) => {
    const next = currentConfig();
    onSettingsChange({
      ...formData,
      tiered_execution: {
        ...next,
        escalation: {
          enabled: next.escalation?.enabled ?? false,
          retries_at_tier: next.escalation?.retries_at_tier ?? 0,
          max_promotions: next.escalation?.max_promotions ?? 0,
          flounder_budget_minutes: next.escalation?.flounder_budget_minutes ?? {},
          ...patch,
        },
      },
    }, opts);
  };

  const handleFlounderBudgetChange = (difficulty: typeof DIFFICULTIES[number], value: string) => {
    const nextBudget = { ...(config?.escalation?.flounder_budget_minutes ?? {}) };
    if (value === '') delete nextBudget[difficulty];
    else nextBudget[difficulty] = Number(value);
    handleEscalationPatch({ flounder_budget_minutes: nextBudget }, { debounce: true });
  };

  const handleReplayThresholdChange = (value: string) => {
    const next = currentConfig();
    onSettingsChange({
      ...formData,
      tiered_execution: {
        ...next,
        replay_threshold: value === '' ? 0 : Number(value),
      },
    }, { debounce: true });
  };

  return (
    <section id="tiered-execution" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
        <Route className="w-4 h-4 text-muted-foreground" />
        Tiered Execution
      </h2>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg bg-muted/20">
          <div>
            <span className="text-sm font-medium text-foreground">Tiered execution</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Global default for task routing; issue metadata can override with <code className="font-mono">tiered_execution: on|off</code>.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Enable tiered execution"
              onClick={handleEnabledChange}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                enabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
            <div className="text-right">
              <span className={`text-xs font-semibold ${reason ? 'text-destructive' : enabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                {resolvedState}
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tiers.length} tier{tiers.length === 1 ? '' : 's'} configured
              </p>
            </div>
          </div>
        </div>

        {(reason || serverTieredError) && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3">
            <p className="text-xs font-semibold text-destructive">
              {saveStatus === 'error' && serverTieredError ? 'Not saved — fix errors' : 'Invalid tiered execution'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {serverTieredError ?? reason}
            </p>
          </div>
        )}

        <div className="px-4 py-3 rounded-lg border border-border/70">
          <div className="flex items-center justify-between gap-3 mb-3">
            <span className="text-sm font-medium text-foreground">Difficulty routing</span>
            <a
              href="https://github.com/eltmon/overdeck/blob/main/docs/TIERED-EXECUTION.md"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              YAML reference
            </a>
          </div>
          <div className="grid gap-2 grid-cols-2 @xl:grid-cols-5">
            {DIFFICULTIES.map((difficulty) => (
              <div key={difficulty} className="rounded-md bg-muted/20 px-3 py-2">
                <div className="text-xs font-medium text-foreground">{difficulty}</div>
                <div className="text-xs text-muted-foreground mt-1 font-mono">
                  {difficultyMap[difficulty] ?? 'unmapped'}
                </div>
              </div>
            ))}
          </div>
          {difficultyError && (
            <p className="mt-3 text-xs text-destructive">{difficultyError}</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">Tier table</span>
            <button
              type="button"
              onClick={handleAddTier}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/30"
            >
              Add tier
            </button>
          </div>
          {tiers.length > 0 ? tiers.map(([name, tier]) => (
            <div key={name} className="px-4 py-3 rounded-lg border border-border/70">
              <div className="grid gap-3 @xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <TierNameInput name={name} tierNames={tierNames} onRename={handleRenameTier} />
                {!tier.distribution && (<>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-foreground">Model</span>
                  <select
                    value={tier.model}
                    onChange={(event) => handleTierPatch(name, { model: event.target.value })}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                  >
                    {!MODEL_OPTIONS.some((model) => model.id === tier.model) && (
                      <option value={tier.model}>{tier.model}</option>
                    )}
                    {Object.entries(MODELS_BY_PROVIDER).map(([providerId, provider]) => (
                      <optgroup key={providerId} label={provider.name}>
                        {provider.models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-foreground">Harness</span>
                  <select
                    value={tier.harness}
                    onChange={(event) => handleTierPatch(name, { harness: event.target.value as Harness })}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                  >
                    {HARNESSES.map((harness) => (
                      <option key={harness} value={harness}>{harness}</option>
                    ))}
                  </select>
                </label>
                </>)}
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-foreground">Difficulties</span>
                  <div className="flex flex-wrap gap-2">
                    {DIFFICULTIES.map((difficulty) => (
                      <label
                        key={difficulty}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                      >
                        <input
                          type="checkbox"
                          checked={tier.difficulties.includes(difficulty)}
                          onChange={() => handleDifficultyToggle(name, difficulty)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        {difficulty}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              {tier.distribution && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">Distribution</span>
                    <span className={`text-xs ${tier.distribution.reduce((sum, entry) => sum + (entry.weight || 0), 0) === 100 ? 'text-muted-foreground' : 'text-destructive'}`}>
                      Total: {tier.distribution.reduce((sum, entry) => sum + (entry.weight || 0), 0)}% (must total 100)
                    </span>
                  </div>
                  {tier.distribution.map((entry, index) => (
                    <div key={index} className="grid gap-2 @2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_90px_70px] items-center">
                      <select
                        value={entry.model}
                        onChange={(event) => handleDistributionPatch(name, index, { model: event.target.value })}
                        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                      >
                        {!MODEL_OPTIONS.some((model) => model.id === entry.model) && (
                          <option value={entry.model}>{entry.model}</option>
                        )}
                        {Object.entries(MODELS_BY_PROVIDER).map(([providerId, provider]) => (
                          <optgroup key={providerId} label={provider.name}>
                            {provider.models.map((model) => (
                              <option key={model.id} value={model.id}>{model.name}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <select
                        value={entry.harness}
                        onChange={(event) => handleDistributionPatch(name, index, { harness: event.target.value as Harness })}
                        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                      >
                        {HARNESSES.map((harness) => (
                          <option key={harness} value={harness}>{harness}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={entry.weight}
                        onChange={(event) => handleDistributionPatch(name, index, { weight: Number(event.target.value) })}
                        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                        aria-label={`weight for entry ${index + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => handleDistributionRemove(name, index)}
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/30"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => handleDistributionAdd(name)}
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/30"
                  >
                    Add model
                  </button>
                </div>
              )}
              {serverTieredError?.includes(`tiers.${name}`) && (
                <p className="mt-3 text-xs text-destructive">{serverTieredError}</p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleDistribution(name)}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/30"
                >
                  {tier.distribution ? 'Use single model' : 'Use distribution'}
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveTier(name)}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30"
                >
                  Remove tier
                </button>
              </div>
            </div>
          )) : (
            <div className="px-4 py-3 rounded-lg border border-border/70 text-xs text-muted-foreground">
              No tiers are configured; tiered execution remains off unless a valid tier table is added.
            </div>
          )}
        </div>

        <div className="px-4 py-3 rounded-lg border border-border/70">
          <span className="text-sm font-medium text-foreground">Supervisor</span>
          <div className="mt-3 grid gap-3 @xl:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">Model</span>
              <select
                value={config?.supervisor?.model ?? DEFAULT_SUPERVISOR_MODEL}
                onChange={(event) => handleSupervisorPatch({ model: event.target.value, harness: config?.supervisor?.harness ?? 'claude-code', subscribe: config?.supervisor?.subscribe ?? 'flagged' })}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
              >
                {Object.entries(MODELS_BY_PROVIDER).map(([providerId, provider]) => (
                  <optgroup key={providerId} label={provider.name}>
                    {provider.models.map((model) => (
                      <option key={model.id} value={model.id}>{model.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">Harness</span>
              <select
                value={config?.supervisor?.harness ?? 'claude-code'}
                onChange={(event) => handleSupervisorPatch({ model: config?.supervisor?.model ?? DEFAULT_SUPERVISOR_MODEL, harness: event.target.value as Harness, subscribe: config?.supervisor?.subscribe ?? 'flagged' })}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
              >
                {HARNESSES.map((harness) => <option key={harness} value={harness}>{harness}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">Subscribe</span>
              <select
                value={config?.supervisor?.subscribe ?? 'flagged'}
                onChange={(event) => handleSupervisorPatch({ model: config?.supervisor?.model ?? DEFAULT_SUPERVISOR_MODEL, harness: config?.supervisor?.harness ?? 'claude-code', subscribe: event.target.value as NonNullable<TieredExecutionConfig['supervisor']>['subscribe'] })}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
              >
                {SUBSCRIPTIONS.map((subscription) => <option key={subscription} value={subscription}>{subscription}</option>)}
              </select>
            </label>
            <div className="flex items-end justify-between gap-3">
              <span className="text-xs font-medium text-foreground">Owns inspection</span>
              <button
                type="button"
                role="switch"
                aria-checked={config?.supervisor?.owns_inspection ?? false}
                aria-label="Supervisor owns inspection"
                onClick={() => handleSupervisorPatch({ model: config?.supervisor?.model ?? DEFAULT_SUPERVISOR_MODEL, harness: config?.supervisor?.harness ?? 'claude-code', subscribe: config?.supervisor?.subscribe ?? 'flagged', owns_inspection: !(config?.supervisor?.owns_inspection ?? false) })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  config?.supervisor?.owns_inspection ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  config?.supervisor?.owns_inspection ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`} />
              </button>
            </div>
          </div>
          {supervisorError && <p className="mt-3 text-xs text-destructive">{supervisorError}</p>}
        </div>

        <div className="px-4 py-3 rounded-lg border border-border/70">
          <span className="text-sm font-medium text-foreground">Kind overrides</span>
          <div className="mt-3 grid gap-3 @lg:grid-cols-2 @2xl:grid-cols-3">
            {ITEM_KINDS.map((kind) => (
              <label key={kind} className="space-y-1.5">
                <span className="text-xs font-medium text-foreground">{kind}</span>
                <select
                  value={byKind[kind] ?? ''}
                  onChange={(event) => handleByKindChange(kind, event.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                >
                  <option value="">Default routing</option>
                  {tierNames.map((tierName) => <option key={tierName} value={tierName}>{tierName}</option>)}
                </select>
              </label>
            ))}
          </div>
          {byKindError && <p className="mt-3 text-xs text-destructive">{byKindError}</p>}
        </div>

        <div className="grid gap-3 @xl:grid-cols-2">
          <div className="px-4 py-3 rounded-lg border border-border/70">
            <span className="text-sm font-medium text-foreground">Feed</span>
            <div className="mt-3 space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">Call-outs</span>
                <select
                  value={config?.feed?.callouts ?? 'off'}
                  onChange={(event) => handleFeedPatch({ callouts: event.target.value as NonNullable<TieredExecutionConfig['feed']>['callouts'], exclude: config?.feed?.exclude ?? [], exclude_subjects: config?.feed?.exclude_subjects ?? [], max_diff_bytes: config?.feed?.max_diff_bytes ?? null })}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                >
                  {CALLOUTS.map((callout) => <option key={callout} value={callout}>{callout}</option>)}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">Max diff bytes</span>
                <input
                  type="number"
                  min="1"
                  value={config?.feed?.max_diff_bytes ?? ''}
                  onChange={(event) => handleFeedPatch({ max_diff_bytes: event.target.value === '' ? null : Number(event.target.value) }, { debounce: true })}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">Exclude paths</span>
                <input
                  type="text"
                  value={listToCsv(config?.feed?.exclude)}
                  onChange={(event) => handleFeedPatch({ exclude: csvToList(event.target.value) }, { debounce: true })}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">Exclude subjects</span>
                <input
                  type="text"
                  value={listToCsv(config?.feed?.exclude_subjects)}
                  onChange={(event) => handleFeedPatch({ exclude_subjects: csvToList(event.target.value) }, { debounce: true })}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                />
              </label>
            </div>
            {feedError && <p className="mt-3 text-xs text-destructive">{feedError}</p>}
          </div>

          <div className="px-4 py-3 rounded-lg border border-border/70">
            <span className="text-sm font-medium text-foreground">Escalation</span>
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-foreground">Enabled</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config?.escalation?.enabled ?? false}
                  aria-label="Enable tier escalation"
                  onClick={() => handleEscalationPatch({ enabled: !(config?.escalation?.enabled ?? false) })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                    config?.escalation?.enabled ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    config?.escalation?.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`} />
                </button>
              </div>
              <div className="grid gap-3 grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-foreground">Retries at tier</span>
                  <input
                    type="number"
                    min="0"
                    value={config?.escalation?.retries_at_tier ?? 0}
                    onChange={(event) => handleEscalationPatch({ retries_at_tier: Number(event.target.value) }, { debounce: true })}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-foreground">Max promotions</span>
                  <input
                    type="number"
                    min="0"
                    value={config?.escalation?.max_promotions ?? 0}
                    onChange={(event) => handleEscalationPatch({ max_promotions: Number(event.target.value) }, { debounce: true })}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                  />
                </label>
              </div>
              <div className="grid gap-2 grid-cols-2 @2xl:grid-cols-5">
                {DIFFICULTIES.map((difficulty) => (
                  <label key={difficulty} className="space-y-1.5">
                    <span className="text-xs font-medium text-foreground">{difficulty}</span>
                    <input
                      type="number"
                      min="1"
                      value={config?.escalation?.flounder_budget_minutes?.[difficulty] ?? ''}
                      onChange={(event) => handleFlounderBudgetChange(difficulty, event.target.value)}
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                    />
                  </label>
                ))}
              </div>
            </div>
            {escalationError && <p className="mt-3 text-xs text-destructive">{escalationError}</p>}
          </div>
        </div>

        <div className="px-4 py-3 rounded-lg border border-border/70">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">Replay threshold</span>
            <input
              type="number"
              min="0.01"
              max="1"
              step="0.01"
              value={config?.replay_threshold ?? 0.5}
              onChange={(event) => handleReplayThresholdChange(event.target.value)}
              className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            />
          </label>
          {replayThresholdError && <p className="mt-3 text-xs text-destructive">{replayThresholdError}</p>}
        </div>
      </div>
    </section>
  );
}
