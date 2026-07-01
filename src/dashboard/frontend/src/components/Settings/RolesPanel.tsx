import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug, ChevronDown, ClipboardCheck, Code, DraftingCompass, Infinity as InfinityIcon, ListOrdered, Loader2, Rocket, Users, Zap, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { PROVIDER_BRANDS } from '../shared/branding';

type RoleId = 'plan' | 'work' | 'review' | 'test' | 'ship' | 'flywheel' | 'strike' | 'sequencer';
type WorkhorseSlot = 'expensive' | 'mid' | 'cheap';
type ModelRef = string;
interface WeightedModelRef { model: ModelRef; weight: number; }
type RoleModelRef = ModelRef | WeightedModelRef[];
type Harness = 'claude-code' | 'ohmypi' | 'codex';
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type FlywheelScope = 'pan-only' | 'all-tracked-projects';

interface RoleSubConfig {
  model?: ModelRef;
}

interface RoleConfig {
  model?: RoleModelRef;
  harness?: Harness;
  effort?: Effort;
  maxAgents?: number;
  scope?: FlywheelScope;
  sub?: Record<string, RoleSubConfig>;
}

type RolesConfig = Partial<Record<RoleId, RoleConfig>>;
type WorkhorsesConfig = Partial<Record<WorkhorseSlot, ModelRef>>;
type RoleConfigPatch = Omit<RoleConfig, 'harness' | 'model'> & { harness?: Harness | null; model?: RoleModelRef; };
type RolesConfigPayload = Partial<Record<RoleId, RoleConfigPatch>>;

interface SettingsResponse {
  roles?: RolesConfig;
  workhorses?: WorkhorsesConfig;
  models?: {
    providers?: Partial<Record<string, boolean>>;
  };
  [key: string]: unknown;
}

interface AvailableModel {
  id: string;
  name: string;
  costPer1MTokens: number;
}

type AvailableModelsResponse = Record<string, AvailableModel[]>;

interface ClaudeAuthStatus {
  loggedIn?: boolean;
  hasAnthropicApiKey?: boolean;
}

interface SubRoleDefinition {
  id: string;
  name: string;
  description: string;
  defaultModel: ModelRef;
}

interface RoleDefinition {
  id: RoleId;
  name: string;
  icon: LucideIcon;
  description: string;
  defaultModel: ModelRef;
  subRoles?: SubRoleDefinition[];
}

const DEFAULT_WORKHORSES: Required<Record<WorkhorseSlot, ModelRef>> = {
  expensive: 'claude-opus-4-8',
  mid: 'claude-sonnet-5',
  cheap: 'claude-haiku-4-5',
};

const WORKHORSE_SLOTS: Array<{ id: WorkhorseSlot; label: string }> = [
  { id: 'expensive', label: 'Expensive' },
  { id: 'mid', label: 'Mid' },
  { id: 'cheap', label: 'Cheap' },
];

const DEFAULT_FLYWHEEL_CONFIG: Required<Pick<RoleConfig, 'effort' | 'maxAgents' | 'scope'>> = {
  effort: 'high',
  maxAgents: 8,
  scope: 'pan-only',
};

const ROLES: RoleDefinition[] = [
  {
    id: 'plan',
    name: 'Plan',
    icon: DraftingCompass,
    description: 'Researches the issue, writes the vBRIEF, and creates beads.',
    defaultModel: 'workhorse:expensive',
  },
  {
    id: 'work',
    name: 'Work',
    icon: Code,
    description: 'Implements beads in the issue workspace.',
    defaultModel: 'workhorse:mid',
    subRoles: [
      { id: 'inspect', name: 'Inspect', description: 'Fast per-bead inspection.', defaultModel: 'workhorse:cheap' },
      { id: 'inspect-deep', name: 'Inspect Deep', description: 'Deeper inspection for complex bead diffs.', defaultModel: 'workhorse:mid' },
    ],
  },
  {
    id: 'strike',
    name: 'Strike',
    icon: Zap,
    description: 'Precision agent — drop in, implement, land directly on main, verify on main. Bypasses plan/review/test/ship.',
    defaultModel: 'workhorse:expensive',
  },
  {
    id: 'review',
    name: 'Review',
    icon: ClipboardCheck,
    description: 'Synthesizes security, correctness, performance, and requirements findings.',
    defaultModel: 'workhorse:expensive',
    subRoles: [
      { id: 'security', name: 'Security', description: 'Security-focused code review.', defaultModel: 'workhorse:expensive' },
      { id: 'correctness', name: 'Correctness', description: 'Logic and behavior validation.', defaultModel: 'workhorse:mid' },
      { id: 'performance', name: 'Performance', description: 'Performance and scalability review.', defaultModel: 'workhorse:mid' },
      { id: 'requirements', name: 'Requirements', description: 'Acceptance criteria and vBRIEF coverage.', defaultModel: 'workhorse:mid' },
      { id: 'synthesis', name: 'Synthesis', description: 'Combines reviewer findings into the final verdict.', defaultModel: 'workhorse:expensive' },
    ],
  },
  {
    id: 'test',
    name: 'Test',
    icon: Bug,
    description: 'Runs verification suites and browser UAT when required.',
    defaultModel: 'workhorse:mid',
  },
  {
    id: 'ship',
    name: 'Ship',
    icon: Rocket,
    description: 'Prepares approved branches for human-controlled merge.',
    defaultModel: 'workhorse:mid',
  },
  {
    id: 'flywheel',
    name: 'Flywheel',
    icon: InfinityIcon,
    description: 'Runs the singleton Fix-All Flywheel orchestrator.',
    defaultModel: 'claude-opus-4-8',
  },
  {
    id: 'sequencer',
    name: 'Sequencer',
    icon: ListOrdered,
    description: 'Ranks the whole open backlog into a reproducible DAG.',
    defaultModel: 'workhorse:expensive',
  },
];

async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

async function fetchAvailableModels(): Promise<AvailableModelsResponse> {
  const res = await fetch('/api/settings/available-models');
  if (!res.ok) throw new Error('Failed to fetch available models');
  return res.json();
}

async function fetchClaudeAuth(): Promise<ClaudeAuthStatus> {
  const res = await fetch('/api/settings/claude-auth');
  if (!res.ok) throw new Error('Failed to fetch Claude auth status');
  return res.json();
}

function getRoleModel(settings: SettingsResponse | undefined, role: RoleDefinition): RoleModelRef {
  return settings?.roles?.[role.id]?.model ?? role.defaultModel;
}

function distributionSummaryText(entries: WeightedModelRef[]): string {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  if (total === 0) return 'distribution';
  return entries
    .map((e) => `${Math.round((e.weight / total) * 100)}% ${e.model}`)
    .join(' / ');
}

function getSubRoleModel(
  settings: SettingsResponse | undefined,
  role: RoleDefinition,
  subRole: SubRoleDefinition,
): ModelRef {
  return settings?.roles?.[role.id]?.sub?.[subRole.id]?.model ?? subRole.defaultModel;
}

function workhorsesWithDefaults(settings: SettingsResponse | undefined): Required<Record<WorkhorseSlot, ModelRef>> {
  return {
    ...DEFAULT_WORKHORSES,
    ...(settings?.workhorses ?? {}),
  };
}

const PARENT_MODEL_REF = 'parent';

function isParentModelRef(value: ModelRef): boolean {
  return value === PARENT_MODEL_REF;
}

function isWorkhorseRef(value: ModelRef): value is `workhorse:${WorkhorseSlot}` {
  return value.startsWith('workhorse:') && WORKHORSE_SLOTS.some((slot) => value === `workhorse:${slot.id}`);
}

function workhorseSlotLabel(slot: WorkhorseSlot): string {
  return WORKHORSE_SLOTS.find((candidate) => candidate.id === slot)?.label ?? slot;
}

function displayModelRef(value: ModelRef): string {
  if (isParentModelRef(value)) return 'Parent';
  if (!isWorkhorseRef(value)) return value;
  const slot = value.replace('workhorse:', '') as WorkhorseSlot;
  return `Workhorse: ${workhorseSlotLabel(slot)}`;
}

function modelRefTooltip(
  value: ModelRef,
  workhorses: Required<Record<WorkhorseSlot, ModelRef>>,
  parentModelRef?: ModelRef,
): string | undefined {
  if (isParentModelRef(value)) {
    return parentModelRef ? `Parent = ${resolveModelRef(parentModelRef, workhorses)}` : undefined;
  }
  if (!isWorkhorseRef(value)) return undefined;
  const slot = value.replace('workhorse:', '') as WorkhorseSlot;
  return `${displayModelRef(value)} = ${workhorses[slot]}`;
}

function modelExists(value: ModelRef, groups: Array<{ models: AvailableModel[] }>): boolean {
  return groups.some((group) => group.models.some((model) => model.id === value));
}

function resolveModelRef(
  value: ModelRef,
  workhorses: Required<Record<WorkhorseSlot, ModelRef>>,
  parentModelRef?: ModelRef,
): ModelRef {
  if (isParentModelRef(value) && parentModelRef) return resolveModelRef(parentModelRef, workhorses);
  if (!isWorkhorseRef(value)) return value;
  const slot = value.replace('workhorse:', '') as WorkhorseSlot;
  return workhorses[slot];
}

function providerForModel(value: ModelRef, groups: Array<{ provider: string; models: AvailableModel[] }>): string | null {
  return groups.find((group) => group.models.some((model) => model.id === value))?.provider ?? null;
}

function providerLabel(provider: string): string {
  const registryProvider = provider === 'glm' ? 'zai' : provider;
  return PROVIDER_BRANDS[registryProvider as keyof typeof PROVIDER_BRANDS]?.label ?? provider;
}

function providerWarning(
  value: ModelRef,
  workhorses: Required<Record<WorkhorseSlot, ModelRef>>,
  groups: Array<{ provider: string; label: string; models: AvailableModel[] }>,
  providers: Partial<Record<string, boolean>> | undefined,
  claudeAuth: ClaudeAuthStatus | undefined,
  parentModelRef?: ModelRef,
): string | null {
  if (isParentModelRef(value)) return null;
  const resolved = resolveModelRef(value, workhorses, parentModelRef);
  const provider = providerForModel(resolved, groups);
  if (!provider) return null;
  const label = providerLabel(provider);
  if (providers?.[provider] === false) return `${label} is not configured; this model will not be reachable until the provider is enabled with credentials.`;
  if (provider === 'anthropic') {
    // Only warn about spend when authenticated via ANTHROPIC_API_KEY — Claude
    // subscription users do not pay per-token for these models.
    if (claudeAuth?.hasAnthropicApiKey) {
      return 'Anthropic API key in use; this model will bill the Anthropic API.';
    }
    return null;
  }
  return null;
}

async function saveRoleConfig(role: RoleId, patch: RoleConfigPatch, subRole?: string): Promise<void> {
  const settings = await fetchSettings();
  const currentRole = settings.roles?.[role] ?? {};
  const nextRole: RoleConfigPatch = subRole
    ? {
        ...currentRole,
        sub: {
          ...(currentRole.sub ?? {}),
          [subRole]: {
            ...(currentRole.sub?.[subRole] ?? {}),
            model: patch.model as ModelRef,
          },
        },
      }
    : {
        ...currentRole,
        ...patch,
      };

  const nextSettings: Omit<SettingsResponse, 'roles'> & { roles: RolesConfigPayload } = {
    ...settings,
    roles: {
      ...(settings.roles ?? {}),
      [role]: nextRole,
    },
  };

  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(nextSettings),
  });
  if (!res.ok) {
    const message = await res.text().catch(() => 'Failed to save role config');
    throw new Error(message || 'Failed to save role config');
  }
}

interface ModelPickerProps {
  label: string;
  value: ModelRef;
  workhorses: Required<Record<WorkhorseSlot, ModelRef>>;
  providerGroups: Array<{ provider: string; label: string; models: AvailableModel[] }>;
  providers?: Partial<Record<string, boolean>>;
  claudeAuth?: ClaudeAuthStatus;
  parentModelRef?: ModelRef;
  disabled: boolean;
  onChange: (value: ModelRef) => void;
}

function ModelPicker({ label, value, workhorses, providerGroups, providers, claudeAuth, parentModelRef, disabled, onChange }: ModelPickerProps) {
  const currentSpecificModelMissing = value && !isParentModelRef(value) && !isWorkhorseRef(value) && !modelExists(value, providerGroups);
  const resolved = resolveModelRef(value, workhorses, parentModelRef);
  const warning = providerWarning(value, workhorses, providerGroups, providers, claudeAuth, parentModelRef);

  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <select
        aria-label={label}
        value={value}
        title={modelRefTooltip(value, workhorses, parentModelRef)}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 bg-popover border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
      >
        {parentModelRef && (
          <optgroup label="Inheritance">
            <option value={PARENT_MODEL_REF}>Parent (inherits {resolveModelRef(parentModelRef, workhorses)})</option>
          </optgroup>
        )}
        <optgroup label="Workhorse">
          {WORKHORSE_SLOTS.map((slot) => (
            <option key={slot.id} value={`workhorse:${slot.id}`}>
              {slot.label} ({workhorses[slot.id]})
            </option>
          ))}
        </optgroup>
        <option disabled>Specific model</option>
        {currentSpecificModelMissing && (
          <optgroup label="Current">
            <option value={value}>{value}</option>
          </optgroup>
        )}
        {providerGroups.map((group) => (
          <optgroup key={group.provider} label={group.label}>
            {group.models.map((model) => (
              <option key={`${group.provider}:${model.id}`} value={model.id}>
                {group.label} &gt; {model.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="text-[11px] leading-snug text-muted-foreground">Resolved: {resolved}</p>
      {warning && (
        <p className="text-[11px] leading-snug text-warning" role="alert">
          {warning}
        </p>
      )}
    </label>
  );
}

function getFlywheelConfig(settings: SettingsResponse | undefined): Pick<RoleConfig, 'harness'> & Required<Pick<RoleConfig, 'effort' | 'maxAgents' | 'scope'>> {
  return {
    ...DEFAULT_FLYWHEEL_CONFIG,
    ...(settings?.roles?.flywheel ?? {}),
  };
}

export function RolesPanel() {
  const queryClient = useQueryClient();
  const [expandedRoles, setExpandedRoles] = useState<Partial<Record<RoleId, boolean>>>({});
  const [distributionMode, setDistributionMode] = useState<Partial<Record<RoleId, boolean>>>({});
  const [draftDistributions, setDraftDistributions] = useState<Partial<Record<RoleId, WeightedModelRef[]>>>({});
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: 60000,
  });
  const availableModelsQuery = useQuery({
    queryKey: ['available-models'],
    queryFn: fetchAvailableModels,
    staleTime: 60000,
  });
  const claudeAuthQuery = useQuery({
    queryKey: ['claude-auth'],
    queryFn: fetchClaudeAuth,
    staleTime: 60000,
  });

  const saveMutation = useMutation({
    mutationFn: ({ role, patch, subRole }: { role: RoleId; patch: RoleConfigPatch; subRole?: string }) => (
      saveRoleConfig(role, patch, subRole)
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Role config updated');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update role config: ${error.message}`);
    },
  });

  const settings = settingsQuery.data;
  const workhorses = workhorsesWithDefaults(settings);
  const providerGroups = Object.entries(availableModelsQuery.data ?? {})
    .filter(([, models]) => Array.isArray(models) && models.length > 0)
    .map(([provider, models]) => ({
      provider,
      label: providerLabel(provider),
      models,
    }));
  const loading = settingsQuery.isLoading || availableModelsQuery.isLoading;

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Users className="w-5 h-5 text-primary" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Role Models</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Route plan, work, review, test, ship, and Flywheel runs through workhorse slots or explicit models.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading role models…
        </div>
      ) : (
        <div className="space-y-3">
          {ROLES.map((role) => {
            const savedRoleModel = getRoleModel(settings, role);
            const savedIsDistribution = Array.isArray(savedRoleModel);
            const isInDistributionMode = distributionMode[role.id] ?? savedIsDistribution;
            const draftRows: WeightedModelRef[] = draftDistributions[role.id] ?? (
              savedIsDistribution
                ? (savedRoleModel as WeightedModelRef[])
                : [{ model: savedRoleModel as ModelRef, weight: 1 }]
            );
            const scalarSavedModel = savedIsDistribution ? undefined : savedRoleModel as ModelRef;
            // When the parent role is a distribution, give sub-roles a concrete representative
            // so their "Parent" option shows a meaningful inherited model.
            const parentModelRefForSubRoles: ModelRef | undefined = savedIsDistribution
              ? (savedRoleModel as WeightedModelRef[]).reduce(
                  (best, e) => (e.weight > best.weight ? e : best),
                  (savedRoleModel as WeightedModelRef[])[0],
                ).model
              : scalarSavedModel;
            const tooltip = scalarSavedModel ? modelRefTooltip(scalarSavedModel, workhorses) : undefined;
            const isExpanded = !!expandedRoles[role.id];
            const canExpand = !!role.subRoles?.length;
            const flywheelConfig = role.id === 'flywheel' ? getFlywheelConfig(settings) : null;
            const draftTotal = draftRows.reduce((s, e) => s + (e.weight > 0 ? e.weight : 0), 0);

            const setDraftRows = (rows: WeightedModelRef[]) =>
              setDraftDistributions((prev) => ({ ...prev, [role.id]: rows }));
            const enterDistributionMode = () => {
              const initial: WeightedModelRef[] = savedIsDistribution
                ? (savedRoleModel as WeightedModelRef[])
                : [{ model: savedRoleModel as ModelRef, weight: 1 }];
              setDraftDistributions((prev) => ({ ...prev, [role.id]: initial }));
              setDistributionMode((prev) => ({ ...prev, [role.id]: true }));
            };
            const exitDistributionMode = () => {
              const representative = draftRows.reduce(
                (best, e) => (e.weight > best.weight ? e : best),
                draftRows[0] ?? { model: role.defaultModel, weight: 0 },
              ).model;
              saveMutation.mutate({ role: role.id, patch: { model: representative } });
              setDistributionMode((prev) => ({ ...prev, [role.id]: false }));
              setDraftDistributions((prev) => { const n = { ...prev }; delete n[role.id]; return n; });
            };
            const saveDistribution = () => {
              const valid = draftRows.filter((e) => e.weight > 0);
              if (valid.length === 0) return;
              saveMutation.mutate({ role: role.id, patch: { model: valid } });
              setDraftDistributions((prev) => { const n = { ...prev }; delete n[role.id]; return n; });
            };

            return (
              <div key={role.id} data-testid="role-card" className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <role.icon className="w-5 h-5 text-primary" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-foreground">{role.name}</h4>
                        <span
                          className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                          title={tooltip}
                        >
                          {savedIsDistribution
                            ? `Distribution: ${distributionSummaryText(savedRoleModel as WeightedModelRef[])}`
                            : `Default: ${displayModelRef(scalarSavedModel!)}`}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-snug text-muted-foreground">{role.description}</p>
                      {canExpand && (
                        <button
                          type="button"
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                          aria-expanded={isExpanded}
                          aria-controls={`${role.id}-subroles`}
                          onClick={() => setExpandedRoles((current) => ({ ...current, [role.id]: !isExpanded }))}
                        >
                          <ChevronDown
                            className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            aria-hidden="true"
                          />
                          {isExpanded ? 'Hide sub-roles' : 'Show sub-roles'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="md:w-80">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground">Model</span>
                        <button
                          type="button"
                          className="text-[11px] text-primary hover:text-primary/80 disabled:opacity-50"
                          disabled={saveMutation.isPending}
                          onClick={isInDistributionMode ? exitDistributionMode : enterDistributionMode}
                        >
                          {isInDistributionMode ? 'Use single model' : 'Use distribution'}
                        </button>
                      </div>

                      {isInDistributionMode ? (
                        <div className="space-y-2" data-testid="distribution-editor">
                          {draftRows.map((entry, idx) => {
                            const pct = draftTotal > 0 && entry.weight > 0
                              ? Math.round((entry.weight / draftTotal) * 100)
                              : 0;
                            return (
                              <div key={idx} className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                  <ModelPicker
                                    label={`Entry ${idx + 1} model`}
                                    value={entry.model}
                                    workhorses={workhorses}
                                    providerGroups={providerGroups}
                                    providers={settings?.models?.providers}
                                    claudeAuth={claudeAuthQuery.data}
                                    disabled={saveMutation.isPending}
                                    onChange={(m) => {
                                      const next = [...draftRows];
                                      next[idx] = { ...entry, model: m };
                                      setDraftRows(next);
                                    }}
                                  />
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <input
                                    aria-label={`Weight for entry ${idx + 1}`}
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={entry.weight}
                                    disabled={saveMutation.isPending}
                                    className="w-14 px-2 py-1.5 bg-popover border border-border rounded text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                                    onChange={(e) => {
                                      const next = [...draftRows];
                                      next[idx] = { ...entry, weight: Math.max(1, parseInt(e.target.value, 10) || 1) };
                                      setDraftRows(next);
                                    }}
                                  />
                                  <span className="text-[11px] text-muted-foreground w-8 text-right">{pct}%</span>
                                  <button
                                    type="button"
                                    aria-label={`Remove entry ${idx + 1}`}
                                    disabled={saveMutation.isPending || draftRows.length <= 1}
                                    className="text-muted-foreground hover:text-destructive disabled:opacity-40 text-xs px-1"
                                    onClick={() => setDraftRows(draftRows.filter((_, i) => i !== idx))}
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              disabled={saveMutation.isPending}
                              className="text-[11px] text-primary hover:text-primary/80 disabled:opacity-50"
                              onClick={() => setDraftRows([...draftRows, { model: role.defaultModel, weight: 1 }])}
                            >
                              + Add model
                            </button>
                            <span
                              className={`text-[11px] tabular-nums ${draftTotal === 100 ? 'text-muted-foreground' : 'text-destructive'}`}
                              data-testid="distribution-total"
                            >
                              Total: {draftTotal}% {draftTotal === 100 ? '' : '(must be 100)'}
                            </span>
                            <button
                              type="button"
                              disabled={saveMutation.isPending || draftTotal !== 100}
                              className="text-[11px] text-primary hover:text-primary/80 disabled:opacity-50 ml-auto"
                              onClick={saveDistribution}
                            >
                              Save distribution
                            </button>
                          </div>
                          <p className="text-[11px] leading-snug text-muted-foreground">
                            Percentages must total 100. Selection is deterministic — the same issue always
                            routes to the same model; change a percentage and only future spawns shift.
                          </p>
                        </div>
                      ) : (
                        <ModelPicker
                          label={`${role.name} model`}
                          value={scalarSavedModel ?? role.defaultModel}
                          workhorses={workhorses}
                          providerGroups={providerGroups}
                          providers={settings?.models?.providers}
                          claudeAuth={claudeAuthQuery.data}
                          disabled={saveMutation.isPending}
                          onChange={(modelRef) => saveMutation.mutate({ role: role.id, patch: { model: modelRef } })}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {flywheelConfig && (
                  <div className="mt-4 border-t border-border pt-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-foreground">Flywheel effort</span>
                        <select
                          aria-label="Flywheel effort"
                          value={flywheelConfig.effort}
                          onChange={(event) => saveMutation.mutate({ role: role.id, patch: { effort: event.target.value as Effort } })}
                          disabled={saveMutation.isPending}
                          className="w-full px-3 py-2 bg-popover border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="xhigh">Extra High</option>
                          <option value="max">Max</option>
                        </select>
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-foreground">Flywheel max agents</span>
                        <input
                          aria-label="Flywheel max agents"
                          type="number"
                          min={1}
                          step={1}
                          value={flywheelConfig.maxAgents}
                          onChange={(event) => saveMutation.mutate({ role: role.id, patch: { maxAgents: Number(event.target.value) } })}
                          disabled={saveMutation.isPending}
                          className="w-full px-3 py-2 bg-popover border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-foreground">Flywheel scope</span>
                        <select
                          aria-label="Flywheel scope"
                          value={flywheelConfig.scope}
                          onChange={(event) => saveMutation.mutate({ role: role.id, patch: { scope: event.target.value as FlywheelScope } })}
                          disabled={saveMutation.isPending}
                          className="w-full px-3 py-2 bg-popover border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                        >
                          <option value="pan-only">PAN only</option>
                          <option value="all-tracked-projects">All tracked projects</option>
                        </select>
                      </label>
                    </div>
                    <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
                      Changes apply on the next tick — no restart needed.
                    </p>
                  </div>
                )}

                {canExpand && isExpanded && (
                  <div id={`${role.id}-subroles`} className="mt-4 border-t border-border pt-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      {role.subRoles?.map((subRole) => {
                        const subModel = getSubRoleModel(settings, role, subRole);
                        const subTooltip = modelRefTooltip(subModel, workhorses, parentModelRefForSubRoles);

                        return (
                          <div key={subRole.id} className="rounded-md border border-border bg-card p-3">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold text-foreground">{subRole.name}</span>
                              <span
                                className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                                title={subTooltip}
                              >
                                Default: {displayModelRef(subModel)}
                              </span>
                            </div>
                            <p className="mb-3 text-[11px] leading-snug text-muted-foreground">{subRole.description}</p>
                            <ModelPicker
                              label={`${role.name} ${subRole.name} model`}
                              value={subModel}
                              workhorses={workhorses}
                              providerGroups={providerGroups}
                              providers={settings?.models?.providers}
                              claudeAuth={claudeAuthQuery.data}
                              parentModelRef={parentModelRefForSubRoles}
                              disabled={saveMutation.isPending}
                              onChange={(modelRef) => saveMutation.mutate({ role: role.id, subRole: subRole.id, patch: { model: modelRef } })}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
