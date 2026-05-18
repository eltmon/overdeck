import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type RoleId = 'plan' | 'work' | 'review' | 'test' | 'ship' | 'flywheel';
type WorkhorseSlot = 'expensive' | 'mid' | 'cheap';
type ModelRef = string;
type Harness = 'claude-code' | 'pi';
type Effort = 'low' | 'medium' | 'high';
type FlywheelScope = 'pan-only' | 'all-tracked-projects';

interface RoleSubConfig {
  model?: ModelRef;
}

interface RoleConfig {
  model?: ModelRef;
  harness?: Harness;
  effort?: Effort;
  maxAgents?: number;
  scope?: FlywheelScope;
  sub?: Record<string, RoleSubConfig>;
}

type RolesConfig = Partial<Record<RoleId, RoleConfig>>;
type WorkhorsesConfig = Partial<Record<WorkhorseSlot, ModelRef>>;

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

interface SubRoleDefinition {
  id: string;
  name: string;
  description: string;
  defaultModel: ModelRef;
}

interface RoleDefinition {
  id: RoleId;
  name: string;
  icon: string;
  description: string;
  defaultModel: ModelRef;
  subRoles?: SubRoleDefinition[];
}

const DEFAULT_WORKHORSES: Required<Record<WorkhorseSlot, ModelRef>> = {
  expensive: 'claude-opus-4-7',
  mid: 'claude-sonnet-4-6',
  cheap: 'claude-haiku-4-5',
};

const WORKHORSE_SLOTS: Array<{ id: WorkhorseSlot; label: string }> = [
  { id: 'expensive', label: 'Expensive' },
  { id: 'mid', label: 'Mid' },
  { id: 'cheap', label: 'Cheap' },
];

const DEFAULT_FLYWHEEL_CONFIG: Required<Pick<RoleConfig, 'harness' | 'effort' | 'maxAgents' | 'scope'>> = {
  harness: 'claude-code',
  effort: 'high',
  maxAgents: 8,
  scope: 'pan-only',
};

const ROLES: RoleDefinition[] = [
  {
    id: 'plan',
    name: 'Plan',
    icon: 'architecture',
    description: 'Researches the issue, writes the vBRIEF, and creates beads.',
    defaultModel: 'workhorse:expensive',
  },
  {
    id: 'work',
    name: 'Work',
    icon: 'code',
    description: 'Implements beads in the issue workspace.',
    defaultModel: 'workhorse:mid',
    subRoles: [
      { id: 'inspect', name: 'Inspect', description: 'Fast per-bead inspection.', defaultModel: 'workhorse:cheap' },
      { id: 'inspect-deep', name: 'Inspect Deep', description: 'Deeper inspection for complex bead diffs.', defaultModel: 'workhorse:mid' },
    ],
  },
  {
    id: 'review',
    name: 'Review',
    icon: 'rate_review',
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
    icon: 'bug_report',
    description: 'Runs verification suites and browser UAT when required.',
    defaultModel: 'workhorse:mid',
  },
  {
    id: 'ship',
    name: 'Ship',
    icon: 'rocket_launch',
    description: 'Prepares approved branches for human-controlled merge.',
    defaultModel: 'workhorse:mid',
  },
  {
    id: 'flywheel',
    name: 'Flywheel',
    icon: 'all_inclusive',
    description: 'Runs the singleton Fix-All Flywheel orchestrator.',
    defaultModel: 'claude-opus-4-7',
  },
];

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  minimax: 'MiniMax',
  zai: 'Z.AI',
  glm: 'Z.AI',
  kimi: 'Kimi',
  mimo: 'MiMo',
  nous: 'Nous Portal',
  openrouter: 'OpenRouter',
};

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

function getRoleModel(settings: SettingsResponse | undefined, role: RoleDefinition): ModelRef {
  return settings?.roles?.[role.id]?.model ?? role.defaultModel;
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

function isWorkhorseRef(value: ModelRef): value is `workhorse:${WorkhorseSlot}` {
  return value.startsWith('workhorse:') && WORKHORSE_SLOTS.some((slot) => value === `workhorse:${slot.id}`);
}

function workhorseSlotLabel(slot: WorkhorseSlot): string {
  return WORKHORSE_SLOTS.find((candidate) => candidate.id === slot)?.label ?? slot;
}

function displayModelRef(value: ModelRef): string {
  if (!isWorkhorseRef(value)) return value;
  const slot = value.replace('workhorse:', '') as WorkhorseSlot;
  return `Workhorse: ${workhorseSlotLabel(slot)}`;
}

function modelRefTooltip(value: ModelRef, workhorses: Required<Record<WorkhorseSlot, ModelRef>>): string | undefined {
  if (!isWorkhorseRef(value)) return undefined;
  const slot = value.replace('workhorse:', '') as WorkhorseSlot;
  return `${displayModelRef(value)} = ${workhorses[slot]}`;
}

function modelExists(value: ModelRef, groups: Array<{ models: AvailableModel[] }>): boolean {
  return groups.some((group) => group.models.some((model) => model.id === value));
}

function resolveModelRef(value: ModelRef, workhorses: Required<Record<WorkhorseSlot, ModelRef>>): ModelRef {
  if (!isWorkhorseRef(value)) return value;
  const slot = value.replace('workhorse:', '') as WorkhorseSlot;
  return workhorses[slot];
}

function providerForModel(value: ModelRef, groups: Array<{ provider: string; models: AvailableModel[] }>): string | null {
  return groups.find((group) => group.models.some((model) => model.id === value))?.provider ?? null;
}

function providerWarning(
  value: ModelRef,
  workhorses: Required<Record<WorkhorseSlot, ModelRef>>,
  groups: Array<{ provider: string; label: string; models: AvailableModel[] }>,
  providers: Partial<Record<string, boolean>> | undefined,
): string | null {
  const resolved = resolveModelRef(value, workhorses);
  const provider = providerForModel(resolved, groups);
  if (!provider) return null;
  const label = PROVIDER_LABELS[provider] ?? provider;
  if (providers?.[provider] === false) return `${label} is not configured; this model will not be reachable until the provider is enabled with credentials.`;
  if (provider === 'anthropic') return 'Anthropic model selected; verify this is intentional for non-Anthropic budget control.';
  return null;
}

async function saveRoleConfig(role: RoleId, patch: RoleConfig, subRole?: string): Promise<void> {
  const settings = await fetchSettings();
  const currentRole = settings.roles?.[role] ?? {};
  const nextRole: RoleConfig = subRole
    ? {
        ...currentRole,
        sub: {
          ...(currentRole.sub ?? {}),
          [subRole]: {
            ...(currentRole.sub?.[subRole] ?? {}),
            model: patch.model,
          },
        },
      }
    : {
        ...currentRole,
        ...patch,
      };

  const nextSettings = {
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
  disabled: boolean;
  onChange: (value: ModelRef) => void;
}

function ModelPicker({ label, value, workhorses, providerGroups, providers, disabled, onChange }: ModelPickerProps) {
  const currentSpecificModelMissing = value && !isWorkhorseRef(value) && !modelExists(value, providerGroups);
  const resolved = resolveModelRef(value, workhorses);
  const warning = providerWarning(value, workhorses, providerGroups, providers);

  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <select
        aria-label={label}
        value={value}
        title={modelRefTooltip(value, workhorses)}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 bg-popover border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
      >
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

function getFlywheelConfig(settings: SettingsResponse | undefined): Required<Pick<RoleConfig, 'harness' | 'effort' | 'maxAgents' | 'scope'>> {
  return {
    ...DEFAULT_FLYWHEEL_CONFIG,
    ...(settings?.roles?.flywheel ?? {}),
  };
}

export function RolesPanel() {
  const queryClient = useQueryClient();
  const [expandedRoles, setExpandedRoles] = useState<Partial<Record<RoleId, boolean>>>({});
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

  const saveMutation = useMutation({
    mutationFn: ({ role, patch, subRole }: { role: RoleId; patch: RoleConfig; subRole?: string }) => (
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
      label: PROVIDER_LABELS[provider] ?? provider,
      models,
    }));
  const loading = settingsQuery.isLoading || availableModelsQuery.isLoading;

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-primary text-xl">group</span>
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
            const roleModel = getRoleModel(settings, role);
            const tooltip = modelRefTooltip(roleModel, workhorses);
            const isExpanded = !!expandedRoles[role.id];
            const canExpand = !!role.subRoles?.length;
            const flywheelConfig = role.id === 'flywheel' ? getFlywheelConfig(settings) : null;

            return (
              <div key={role.id} data-testid="role-card" className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-primary text-xl">{role.icon}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-foreground">{role.name}</h4>
                        <span
                          className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                          title={tooltip}
                        >
                          Default: {displayModelRef(roleModel)}
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
                          <span className="material-symbols-outlined text-sm">
                            {isExpanded ? 'expand_less' : 'expand_more'}
                          </span>
                          {isExpanded ? 'Hide sub-roles' : 'Show sub-roles'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="md:w-80">
                    <ModelPicker
                      label={`${role.name} model`}
                      value={roleModel}
                      workhorses={workhorses}
                      providerGroups={providerGroups}
                      providers={settings?.models?.providers}
                      disabled={saveMutation.isPending}
                      onChange={(modelRef) => saveMutation.mutate({ role: role.id, patch: { model: modelRef } })}
                    />
                  </div>
                </div>

                {flywheelConfig && (
                  <div className="mt-4 border-t border-border pt-3">
                    <div className="grid gap-3 md:grid-cols-4">
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-foreground">Flywheel harness</span>
                        <select
                          aria-label="Flywheel harness"
                          value={flywheelConfig.harness}
                          onChange={(event) => saveMutation.mutate({ role: role.id, patch: { harness: event.target.value as Harness } })}
                          disabled={saveMutation.isPending}
                          className="w-full px-3 py-2 bg-popover border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                        >
                          <option value="claude-code">Claude Code</option>
                          <option value="pi">Pi</option>
                        </select>
                      </label>
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
                        const subTooltip = modelRefTooltip(subModel, workhorses);

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
