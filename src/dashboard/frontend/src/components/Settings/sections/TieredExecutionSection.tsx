import { useState } from 'react';
import { Route } from 'lucide-react';
import { type Harness, type SettingsConfig, type TieredExecutionConfig } from '../types';
import type { SaveStatus } from '../hooks/useAutosavePipeline';
import { MODELS_BY_PROVIDER } from '../modelCatalog';
import {
  blendedCost,
  crewLabel,
  deriveTierName,
  DIFFICULTIES,
  importCrews,
  providerDefaultHarness,
  renderYamlPreview,
  serializeCrews,
  type Crew,
  type CrewAssignments,
  type CrewRest,
} from './tiered-crews';
import { CrewRow } from './CrewRow';

interface TieredExecutionSectionProps {
  formData: SettingsConfig;
  saveErrorMessage?: string | null;
  saveStatus?: SaveStatus;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

const ITEM_KINDS = ['docs', 'api', 'backend', 'frontend', 'infra', 'test', 'refactor', 'design', 'spike'] as const;
const HARNESSES: Harness[] = ['claude-code', 'ohmypi', 'codex'];
const CALLOUTS = ['off', 'notify', 'corroborate'] as const;
// Defaults must NEVER be a frontier model (fable/opus). The first catalog
// entries are premium models, and defaulting new crews/the supervisor to
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

  for (const [tierName, tier] of tiers) {
    if (tier.distribution) {
      if (tier.distribution.length === 0) return `tiered_execution.tiers.${tierName}.distribution must be a non-empty array`;
      const total = tier.distribution.reduce((sum, entry) => sum + (entry.weight || 0), 0);
      if (total !== 100) return `tiered_execution.tiers.${tierName}.distribution weights must total exactly 100 (got ${total})`;
    }
    if (!tier.model) return `tiered_execution.tiers.${tierName}.model is required`;
    if (!tier.harness) return `tiered_execution.tiers.${tierName}.harness is required`;
  }

  for (const [kind, tierName] of Object.entries(config.by_kind ?? {})) {
    if (tierName && !config.tiers[tierName]) return `tiered_execution.by_kind.${kind} references unknown tier '${tierName}'`;
  }

  if (!config.supervisor) return 'tiered_execution.supervisor is required when tiered execution tiers are configured';
  return null;
}

const DIFFICULTY_SUBTITLES = {
  trivial: 'typo-level fixes',
  simple: 'small scoped edits',
  medium: 'typical tasks',
  complex: 'multi-file work',
  expert: 'judgment calls',
} as const;

export function TieredExecutionSection({
  formData,
  saveErrorMessage,
  saveStatus = 'idle',
  onSettingsChange,
}: TieredExecutionSectionProps) {
  const config = formData.tiered_execution;
  const normalizedConfig = {
    ...defaultTieredExecution(config?.enabled ?? false),
    ...config,
    by_kind: config?.by_kind ?? config?.byKind ?? {},
  };
  const { crews, assign, rest } = importCrews(normalizedConfig);
  let outgoingConfig = normalizedConfig;
  try {
    outgoingConfig = serializeCrews(crews, assign, rest);
  } catch {
    // Keep invalid hand-authored config inspectable; guarded UI actions cannot save this state.
  }
  const [openCrewId, setOpenCrewId] = useState<string | null>(null);
  const [supervisorOpen, setSupervisorOpen] = useState(false);
  const [kindDraft, setKindDraft] = useState<typeof ITEM_KINDS[number]>('docs');
  const [crewDraft, setCrewDraft] = useState('');
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const byKind = rest.by_kind;
  const supervisor = rest.supervisor;
  const supervisorModelName = Object.values(MODELS_BY_PROVIDER).flatMap((provider) => provider.models)
    .find((model) => model.id === (supervisor?.model ?? DEFAULT_SUPERVISOR_MODEL))?.name ?? supervisor?.model ?? DEFAULT_SUPERVISOR_MODEL;
  const crewName = (crewId: string | undefined) => {
    const crew = crews.find((entry) => entry.id === crewId);
    return crew ? crewLabel(crew) : crewId ?? 'Unknown crew';
  };
  const reason = validationReason(config);
  const enabled = config?.enabled ?? false;
  const serverTieredError = saveErrorMessage?.includes('tiered_execution') ? saveErrorMessage : null;
  const invalidReason = serverTieredError ?? reason;
  const resolvedState = !enabled ? 'Off' : invalidReason ? `Invalid — ${invalidReason}` : 'On · valid';
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

  const writeCrews = (nextCrews: readonly Crew[], nextAssign: CrewAssignments, nextRest: CrewRest = rest) => {
    updateTieredExecution(serializeCrews(nextCrews, nextAssign, nextRest));
  };

  const handleAssignment = (difficulty: typeof DIFFICULTIES[number], crewId: string) => {
    const currentCrewId = assign[difficulty];
    const currentCrewDifficulties = DIFFICULTIES.filter((entry) => assign[entry] === currentCrewId);
    const currentCrewKinds = Object.entries(byKind).filter(([, id]) => id === currentCrewId).map(([kind]) => kind);
    if (crewId !== currentCrewId && currentCrewDifficulties.length === 1 && currentCrewKinds.length > 0) {
      setAssignmentError(`Move or remove ${currentCrewKinds.join(', ')} kind overrides before reassigning this crew's final difficulty.`);
      return;
    }
    setAssignmentError(null);
    if (crewId !== 'new') {
      writeCrews(crews, { ...assign, [difficulty]: crewId });
      return;
    }
    const id = `crew-${crypto.randomUUID()}`;
    const crew: Crew = { id, model: DEFAULT_MODEL, harness: 'claude-code' };
    const nextAssign = crews.length === 0
      ? Object.fromEntries(DIFFICULTIES.map((entry) => [entry, id])) as CrewAssignments
      : { ...assign, [difficulty]: id };
    setOpenCrewId(deriveTierName(DIFFICULTIES.filter((entry) => nextAssign[entry] === id)));
    writeCrews([...crews, crew], nextAssign);
  };

  const handleSupervisorPatch = (patch: Partial<NonNullable<TieredExecutionConfig['supervisor']>>) => {
    writeCrews(crews, assign, {
      ...rest,
      supervisor: {
        model: rest.supervisor?.model ?? DEFAULT_SUPERVISOR_MODEL,
        harness: rest.supervisor?.harness ?? 'claude-code',
        subscribe: rest.supervisor?.subscribe ?? 'flagged',
        owns_inspection: rest.supervisor?.owns_inspection ?? true,
        ...patch,
      },
    });
  };

  const handleByKindChange = (kind: typeof ITEM_KINDS[number], crewId: string) => {
    const next = { ...byKind };
    if (crewId) next[kind] = crewId;
    else delete next[kind];
    writeCrews(crews, assign, { ...rest, by_kind: next });
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

  const handleCompactionRerouteChange = (value: 'off' | 'on') => {
    const next = currentConfig();
    updateTieredExecution({ ...next, compaction_reroute: value });
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
            <span className="text-sm font-medium text-foreground">Route work by difficulty</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each difficulty picks one crew. A per-issue override wins over the plan, and the plan wins over this global default.
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
              <span className={`text-xs font-semibold ${invalidReason ? 'text-destructive' : enabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                {resolvedState}
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                {crews.length} crew{crews.length === 1 ? '' : 's'} configured
              </p>
            </div>
          </div>
          {assignmentError && <p className="mt-3 text-xs text-destructive">{assignmentError}</p>}
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

        <div className="px-4 py-3 rounded-lg border border-border/70" aria-label="Difficulty routing board">
          <div className="flex items-center justify-between gap-3 mb-3">
            <span className="text-sm font-medium text-foreground">Who handles each difficulty?</span>
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
            {DIFFICULTIES.map((difficulty, index) => {
              const crew = crews.find((entry) => entry.id === assign[difficulty]);
              const cost = crew ? blendedCost(crew) : null;
              return (
              <div key={difficulty} className="rounded-md border border-border/70 border-t-2 bg-muted/20 px-3 py-2" style={{ borderTopColor: `var(--crew-${String.fromCharCode(97 + index)})` }}>
                <div className="text-xs font-semibold capitalize text-foreground">{difficulty}</div>
                <div className="mb-2 text-[11px] text-muted-foreground">{DIFFICULTY_SUBTITLES[difficulty]}</div>
                <select
                  required
                  aria-label={`crew for ${difficulty}`}
                  value={crew?.id ?? 'new'}
                  onChange={(event) => handleAssignment(difficulty, event.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
                >
                  {crews.map((entry) => <option key={entry.id} value={entry.id}>{crewLabel(entry)}</option>)}
                  <option value="new">+ new crew…</option>
                </select>
                <div className="mt-2 truncate text-[11px] text-muted-foreground">
                  {crew ? crewLabel(crew) : 'Choose a crew'}
                </div>
                <div className="mt-1 text-[11px] font-medium text-cyan-600 dark:text-cyan-400">
                  {cost == null ? '—' : `≈ $${cost.toFixed(1)}/1M`}
                </div>
              </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">The crews</span>
            <span className="text-[11px] text-muted-foreground">click a crew to edit · new crews start on Haiku 4.5, never a frontier model</span>
          </div>
          {crews.length > 0 ? crews.map((crew) => (
            <CrewRow
              key={crew.id}
              crew={crew}
              owned={DIFFICULTIES.filter((difficulty) => assign[difficulty] === crew.id)}
              ownedKinds={Object.entries(byKind).filter(([, crewId]) => crewId === crew.id).map(([kind]) => kind)}
              settings={formData}
              open={openCrewId === crew.id}
              onToggle={() => setOpenCrewId(openCrewId === crew.id ? null : crew.id)}
              onChange={(nextCrew) => writeCrews(crews.map((entry) => entry.id === crew.id ? nextCrew : entry), assign)}
              onRemove={() => writeCrews(crews.filter((entry) => entry.id !== crew.id), assign)}
            />
          )) : (
            <div className="px-4 py-3 rounded-lg border border-border/70 text-xs text-muted-foreground">
              Choose “+ new crew…” on the board to create the first crew.
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border/70">
          <button type="button" aria-expanded={supervisorOpen} onClick={() => setSupervisorOpen(!supervisorOpen)} className="flex w-full items-center gap-2 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-primary">
            <span>{supervisorOpen ? '▾' : '▸'}</span><span className="text-sm font-medium text-foreground">Standing reviewer</span>
            <span className="text-xs text-muted-foreground">— {supervisor?.subscribe === 'all' ? 'reviews every commit' : supervisor?.subscribe === 'sampled' ? 'reviews a sample' : 'wakes on flagged commits'} · {supervisorModelName} · {supervisor?.owns_inspection ?? true ? 'owns inspection' : 'inspection stays separate'}</span>
          </button>
          {supervisorOpen && <div className="grid gap-3 border-t border-border/70 px-4 py-3 @xl:grid-cols-2">
            <p className="col-span-full text-xs text-muted-foreground">Wakes on every commit a crew makes and reviews the diff against the task's acceptance criteria. Required whenever crews are configured.</p>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">Model</span>
              <select
                value={supervisor?.model ?? DEFAULT_SUPERVISOR_MODEL}
                onChange={(event) => handleSupervisorPatch({ model: event.target.value })}
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
                value={supervisor?.harness ?? 'claude-code'}
                onChange={(event) => handleSupervisorPatch({ harness: event.target.value === 'auto' ? providerDefaultHarness(supervisor?.model ?? DEFAULT_SUPERVISOR_MODEL, formData) : event.target.value as Harness })}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
              >
                <option value="auto">auto ({providerDefaultHarness(supervisor?.model ?? DEFAULT_SUPERVISOR_MODEL, formData)})</option>
                {HARNESSES.map((harness) => <option key={harness} value={harness}>{harness}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">Reviews</span>
              <select
                aria-label="Subscribe"
                value={supervisor?.subscribe ?? 'flagged'}
                onChange={(event) => handleSupervisorPatch({ subscribe: event.target.value as NonNullable<TieredExecutionConfig['supervisor']>['subscribe'] })}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
              >
                <option value="all">every commit (all)</option><option value="flagged">only commits flagged for inspection (flagged)</option><option value="sampled">a sample, for cost measurement (sampled)</option>
              </select>
            </label>
            <div className="flex items-end justify-between gap-3">
              <span className="text-xs font-medium text-foreground">Owns inspection</span>
              <button
                type="button"
                role="switch"
                aria-checked={supervisor?.owns_inspection ?? true}
                aria-label="Supervisor owns inspection"
                onClick={() => handleSupervisorPatch({ owns_inspection: !(supervisor?.owns_inspection ?? true) })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  supervisor?.owns_inspection ?? true ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  supervisor?.owns_inspection ?? true ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`} />
              </button>
            </div>
          </div>}
          {supervisorError && <p className="mt-3 text-xs text-destructive">{supervisorError}</p>}
        </div>

        <div className="px-4 py-3 rounded-lg border border-border/70">
          <span className="text-sm font-medium text-foreground">Kind overrides</span>
          <p className="mt-2 text-xs text-muted-foreground">{Object.keys(byKind).length ? `${Object.keys(byKind).length} kinds overridden; the rest follow difficulty routing.` : 'All kinds follow difficulty routing.'}</p>
          <div className="mt-2 flex flex-wrap gap-2">{Object.entries(byKind).map(([kind, crewId]) => <span key={kind} className="rounded-full border border-border px-2 py-1 text-xs">{kind} → {crewName(crewId)}<button type="button" aria-label={`Remove ${kind} override`} onClick={() => handleByKindChange(kind as typeof ITEM_KINDS[number], '')} className="ml-2">×</button></span>)}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <select aria-label="Kind to override" value={kindDraft} onChange={(event) => setKindDraft(event.target.value as typeof ITEM_KINDS[number])} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">{ITEM_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>
            <select aria-label="Crew for kind override" value={crewDraft} onChange={(event) => setCrewDraft(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"><option value="">Choose crew</option>{crews.map((crew) => <option key={crew.id} value={crew.id}>{crewLabel(crew)}</option>)}</select>
            <button type="button" disabled={!crewDraft} onClick={() => handleByKindChange(kindDraft, crewDraft)} className="rounded-md border border-border px-2.5 py-1.5 text-xs">Add override</button>
          </div>
          {byKindError && <p className="mt-3 text-xs text-destructive">{byKindError}</p>}
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium text-foreground">Advanced</span>
          <details className="rounded-lg border border-border/70">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">Commit feed <span className="ml-2 text-xs font-normal text-muted-foreground">— {config?.feed?.callouts === 'notify' ? 'listeners may flag once' : config?.feed?.callouts === 'corroborate' ? 'flags trigger supervisor review' : 'read-only for every crew'}</span></summary>
            <div className="space-y-3 border-t border-border/70 px-4 py-3">
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
          </details>

          <details className="rounded-lg border border-border/70">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">Escalation <span className="ml-2 text-xs font-normal text-muted-foreground">— {config?.escalation?.enabled ? `on · up to ${config.escalation.max_promotions ?? 0} promotions` : 'off — failures never change crews'}</span></summary>
            <div className="space-y-3 border-t border-border/70 px-4 py-3">
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
                      aria-label={`Flounder budget ${difficulty}`}
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
          </details>
        </div>

        <details className="rounded-lg border border-border/70">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">Session replay <span className="ml-2 text-xs font-normal text-muted-foreground">— threshold {config?.replay_threshold ?? 0.5} · {config?.compaction_reroute === 'on' ? 're-plan after compaction' : 'bring back the same session'}</span></summary>
          <div className="grid gap-3 border-t border-border/70 px-4 py-3 @xl:grid-cols-2">
          <label className="block space-y-1.5"><span className="text-xs font-medium text-foreground">Replay threshold</span>
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
          <label className="block space-y-1.5"><span className="text-xs font-medium text-foreground">After compaction</span><select aria-label="Compaction reroute" value={config?.compaction_reroute ?? 'off'} onChange={(event) => handleCompactionRerouteChange(event.target.value as 'off' | 'on')} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"><option value="off">bring back the same session as before</option><option value="on">re-plan remaining work; retire crews no longer needed</option></select></label>
          {replayThresholdError && <p className="mt-3 text-xs text-destructive">{replayThresholdError}</p>}
          </div>
        </details>

        <details className="rounded-lg border border-border/70">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">What this writes to config.yaml <span className="ml-2 text-xs font-normal text-muted-foreground">— {Object.keys(normalizedConfig.tiers).join(', ') || 'no tiers'}</span></summary>
          <pre className="overflow-x-auto border-t border-border/70 bg-muted/20 px-4 py-3 text-xs text-foreground">{renderYamlPreview(outgoingConfig)}</pre>
        </details>
      </div>
    </section>
  );
}
