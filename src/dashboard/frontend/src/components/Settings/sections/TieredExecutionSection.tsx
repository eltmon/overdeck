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
const HARNESSES: Harness[] = ['claude-code', 'ohmypi', 'codex'];
const MODEL_OPTIONS = Object.entries(MODELS_BY_PROVIDER).flatMap(([providerId, provider]) =>
  provider.models.map((model) => ({
    providerId,
    providerName: provider.name,
    id: model.id,
    name: model.name,
  })),
);
const DEFAULT_MODEL = MODEL_OPTIONS[0]?.id ?? 'claude-haiku-4-5';

function defaultTieredExecution(enabled: boolean): TieredExecutionConfig {
  return {
    enabled,
    tiers: {},
    by_kind: {},
    replay_threshold: 0.5,
  };
}

function validationReason(config: TieredExecutionConfig | undefined): string | null {
  if (!config) return null;
  const tiers = Object.entries(config.tiers ?? {});
  const shouldValidateTierTable = config.enabled || tiers.length > 0 || Object.keys(config.by_kind ?? {}).length > 0 || config.supervisor !== undefined;
  if (!shouldValidateTierTable) return null;

  const owners = new Map<string, string[]>();
  for (const [tierName, tier] of tiers) {
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

export function TieredExecutionSection({
  formData,
  saveErrorMessage,
  saveStatus = 'idle',
  onSettingsChange,
}: TieredExecutionSectionProps) {
  const config = formData.tiered_execution;
  const tiers = Object.entries(config?.tiers ?? {});
  const difficultyMap = inputDifficultyMap(config);
  const byKind = config?.byKind ?? config?.by_kind ?? {};
  const byKindEntries = Object.entries(byKind).filter(([, tierName]) => Boolean(tierName));
  const reason = validationReason(config);
  const enabled = config?.enabled ?? false;
  const resolvedState = enabled && !reason ? 'Enabled' : reason ? 'Invalid' : 'Disabled';
  const serverTieredError = saveErrorMessage?.includes('tiered_execution') ? saveErrorMessage : null;
  const difficultyError = serverTieredError?.includes('tiered_execution difficulty') ? serverTieredError : null;

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

  const handleRemoveTier = (name: string) => {
    const next = currentConfig();
    const { [name]: _removed, ...tiersWithoutRemoved } = next.tiers;
    updateTieredExecution({
      ...next,
      tiers: tiersWithoutRemoved,
    });
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
              Global default for bead routing; issue metadata can override with <code className="font-mono">tiered_execution: on|off</code>.
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
          <div className="grid gap-2 sm:grid-cols-5">
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
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-foreground">Tier name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => handleRenameTier(name, event.target.value.trim())}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono text-foreground focus:ring-1 focus:ring-primary"
                  />
                </label>
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
              {serverTieredError?.includes(`tiers.${name}`) && (
                <p className="mt-3 text-xs text-destructive">{serverTieredError}</p>
              )}
              <div className="mt-3 flex justify-end">
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

        <div className="grid gap-3 md:grid-cols-2">
          <div className="px-4 py-3 rounded-lg border border-border/70">
            <span className="text-sm font-medium text-foreground">Supervisor</span>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p><span className="text-foreground">Model:</span> <code className="font-mono">{config?.supervisor?.model ?? 'not configured'}</code></p>
              <p><span className="text-foreground">Harness:</span> {config?.supervisor?.harness ?? 'not configured'}</p>
              <p><span className="text-foreground">Subscribe:</span> {config?.supervisor?.subscribe ?? 'not configured'}</p>
              <p><span className="text-foreground">Owns inspection:</span> {config?.supervisor?.owns_inspection ? 'yes' : 'no'}</p>
            </div>
          </div>

          <div className="px-4 py-3 rounded-lg border border-border/70">
            <span className="text-sm font-medium text-foreground">Feed and escalation</span>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p><span className="text-foreground">Call-outs:</span> {config?.feed?.callouts ?? 'off'}</p>
              <p><span className="text-foreground">Diff cap:</span> {config?.feed?.max_diff_bytes ?? 'none'}</p>
              <p><span className="text-foreground">Escalation:</span> {config?.escalation?.enabled ? 'enabled' : 'disabled'}</p>
              <p><span className="text-foreground">Compaction reroute:</span> {config?.compaction_reroute ?? 'off'}</p>
            </div>
          </div>
        </div>

        {byKindEntries.length > 0 && (
          <div className="px-4 py-3 rounded-lg border border-border/70">
            <span className="text-sm font-medium text-foreground">Kind overrides</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {byKindEntries.map(([kind, tierName]) => (
                <span key={kind} className="text-xs rounded-md bg-muted/30 px-2 py-1 text-muted-foreground">
                  {kind}: <span className="font-mono text-foreground">{tierName}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
