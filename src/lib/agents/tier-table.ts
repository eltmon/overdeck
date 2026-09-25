import type { RuntimeName } from '../runtimes/types.js';
import type { ModelId } from '../settings.js';
import type { XBriefDifficulty, XBriefItemKind } from '../xbrief/types.js';
import type { AuthMode } from '../subscription-types.js';
import type { ModelProvider } from '../model-fallback.js';
import { resolveModelId } from '../model-capabilities.js';
import { getProviderForModel, PROVIDERS } from '../providers.js';
import { canUseHarness } from '../harness-policy.js';
import { derefWorkhorse } from '../config-yaml/roles.js';
import type { WorkhorsesConfig } from '../config-yaml/schema.js';

export const TIERED_EXECUTION_DIFFICULTIES: readonly XBriefDifficulty[] = ['trivial', 'simple', 'medium', 'complex', 'expert'] as const;
export const TIERED_EXECUTION_SUBSCRIPTIONS = ['all', 'flagged', 'sampled'] as const;
export const TIERED_EXECUTION_ITEM_KINDS: readonly XBriefItemKind[] = ['docs', 'api', 'backend', 'frontend', 'infra', 'test', 'refactor', 'design', 'spike'] as const;
export const TIERED_EXECUTION_CALLOUT_POLICIES = ['off', 'notify', 'corroborate'] as const;
export const TIERED_EXECUTION_COMPACTION_REROUTE_POLICIES = ['off', 'on'] as const;

export type TieredExecutionSubscription = typeof TIERED_EXECUTION_SUBSCRIPTIONS[number];
export type TieredExecutionCalloutPolicy = typeof TIERED_EXECUTION_CALLOUT_POLICIES[number];
export type TieredExecutionCompactionReroutePolicy = typeof TIERED_EXECUTION_COMPACTION_REROUTE_POLICIES[number];

export interface TierDistributionEntry {
  /** The concrete model id this entry launches (a `workhorse:` ref is already dereffed). */
  model: ModelId | string;
  /**
   * PAN-4191: the `workhorse:<slot>` ref the operator wrote, when `model` came
   * from one. It is what the settings save writes back to config.yaml, so a
   * Settings save never pins the slot's current model as a literal.
   */
  modelRef?: string;
  harness: RuntimeName;
  /** Integer percentage; a tier's entries must total exactly 100. */
  weight: number;
}

export interface TierDefinition {
  /** The concrete model id this tier launches (a `workhorse:` ref is already dereffed). */
  model: ModelId | string;
  /** PAN-4191: the `workhorse:<slot>` ref behind `model`, when there is one. */
  modelRef?: string;
  harness: RuntimeName;
  difficulties: XBriefDifficulty[];
  /**
   * PAN-2391: weighted model+harness entries this tier spreads its beads
   * across (to consume multiple subscription plans). When present, the raw
   * config declared `distribution` INSTEAD of model/harness; the normalized
   * model/harness above are the max-weight representative so distribution-
   * unaware readers degrade safely. Selection is deterministic per bead
   * (see pickDistributionEntry).
   */
  distribution?: TierDistributionEntry[];
}

export interface TieredExecutionSupervisorConfig {
  model: ModelId | string;
  /** PAN-4191: the `workhorse:<slot>` ref behind `model`, when there is one. */
  modelRef?: string;
  harness: RuntimeName;
  subscribe: TieredExecutionSubscription;
}

export interface TieredExecutionFeedConfig {
  callouts?: TieredExecutionCalloutPolicy;
  exclude?: string[];
  exclude_subjects?: string[];
  max_diff_bytes?: number | null;
}

export interface ValidatedTieredExecutionFeedConfig {
  callouts: TieredExecutionCalloutPolicy;
  exclude: string[];
  exclude_subjects: string[];
  max_diff_bytes: number | null;
}

export interface TieredEscalationConfig {
  enabled?: boolean;
  retries_at_tier?: number;
  max_promotions?: number;
}

export interface ValidatedEscalationConfig {
  enabled: boolean;
  retries_at_tier: number;
  max_promotions: number;
}

export interface TieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, TierDefinition>;
  supervisor?: TieredExecutionSupervisorConfig;
  by_kind?: Partial<Record<XBriefItemKind, string>>;
  feed?: TieredExecutionFeedConfig;
  escalation?: TieredEscalationConfig;
  compaction_reroute?: TieredExecutionCompactionReroutePolicy;
  replay_threshold: number;
}

export interface ValidatedTieredExecutionConfig extends TieredExecutionConfig {
  difficultyToTier: Partial<Record<XBriefDifficulty, string>>;
  byKind: Partial<Record<XBriefItemKind, string>>;
  feed: ValidatedTieredExecutionFeedConfig;
  escalation: ValidatedEscalationConfig;
  compaction_reroute: TieredExecutionCompactionReroutePolicy;
}

export interface TieredExecutionValidationContext {
  providerAuth?: Partial<Record<ModelProvider, AuthMode>>;
  /**
   * PAN-4191: the effective workhorse slots a tier `model: workhorse:<slot>`
   * resolves through (the same `derefWorkhorse` that `roles.*` refs use).
   * Without them every workhorse ref fails as undefined.
   */
  workhorses?: WorkhorsesConfig;
}

export class TieredExecutionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TieredExecutionConfigError';
  }
}

export const DEFAULT_TIERED_EXECUTION_CONFIG: ValidatedTieredExecutionConfig = {
  enabled: false,
  tiers: {},
  supervisor: undefined,
  by_kind: {},
  byKind: {},
  feed: {
    callouts: 'off',
    exclude: [],
    exclude_subjects: [],
    max_diff_bytes: null,
  },
  escalation: {
    enabled: false,
    retries_at_tier: 0,
    max_promotions: 0,
  },
  compaction_reroute: 'off',
  replay_threshold: 0.5,
  difficultyToTier: {},
};

const TIERED_EXECUTION_ISSUE_OVERRIDES = ['on', 'off'] as const;
export type TieredExecutionIssueOverride = typeof TIERED_EXECUTION_ISSUE_OVERRIDES[number];

export function resolveTieredExecutionBlock(
  config: Pick<TieredExecutionConfig, 'enabled'>,
  planMetadata: { [key: string]: unknown } | undefined,
  recordOverride: 'on' | 'off' | null | undefined,
): {
  effective: boolean;
  source: 'issue-override' | 'plan-metadata' | 'global';
  override: 'on' | 'off' | null;
} {
  const effective = resolveTieredExecutionEnabled(config, planMetadata, recordOverride);

  if (recordOverride === 'on' || recordOverride === 'off') {
    return {
      effective,
      source: 'issue-override',
      override: recordOverride,
    };
  }

  const planValue = planMetadata?.tiered_execution;
  if (planValue === 'on' || planValue === 'off') {
    return {
      effective,
      source: 'plan-metadata',
      override: null,
    };
  }

  return {
    effective,
    source: 'global',
    override: null,
  };
}

/**
 * Per-issue tiered_execution opt-in/out (PAN-1791 FR-9, PAN-2383 FR-1). Resolves with precedence:
 * record override > plan.metadata.tiered_execution > config.enabled.
 *
 * An issue's xBRIEF may set `tiered_execution: 'on' | 'off'` in plan.metadata; a record
 * override takes precedence; an explicit value wins over the global `tiered_execution.enabled`
 * flag, and an unset value inherits it — zero behavior change when no overrides exist.
 * Any invalid value is a config error (fail-loud, no silent inherit on typos).
 */
export function resolveTieredExecutionEnabled(
  config: Pick<TieredExecutionConfig, 'enabled'>,
  planMetadata?: { [key: string]: unknown },
  recordOverride?: 'on' | 'off' | null,
): boolean {
  // Record override takes precedence
  if (recordOverride === 'on') return true;
  if (recordOverride === 'off') return false;

  // Plan metadata second
  const planValue = planMetadata?.tiered_execution;
  if (planValue === undefined || planValue === null) return config.enabled;
  if (planValue === 'on') return true;
  if (planValue === 'off') return false;
  throw new TieredExecutionConfigError(
    `plan.metadata.tiered_execution must be one of ${TIERED_EXECUTION_ISSUE_OVERRIDES.join(', ')}; got ${JSON.stringify(planValue)}`,
  );
}

/**
 * Issue-aware wrapper for resolveTieredExecutionEnabled (PAN-2383 foundation).
 * PAN-3917: the per-issue record override this used to read
 * is gone with the record plane and had no surviving writer — precedence
 * collapses to plan.metadata.tiered_execution > config.enabled. `issueId`
 * stays in the signature so call sites (spawn-prep.ts) do not need to branch
 * on whether an issue is known.
 */
export function resolveTieredExecutionEnabledForIssue(
  config: Pick<TieredExecutionConfig, 'enabled'>,
  _issueId: string,
  planMetadata?: { [key: string]: unknown },
): boolean {
  return resolveTieredExecutionEnabled(config, planMetadata);
}

function isRuntimeName(value: string): value is RuntimeName {
  return value === 'claude-code' || value === 'ohmypi' || value === 'codex' || value === 'acp' || value === 'kimi-code' || value === 'opencode' || value === 'muse';
}

function isDifficulty(value: string): value is XBriefDifficulty {
  return (TIERED_EXECUTION_DIFFICULTIES as readonly string[]).includes(value);
}

function isSubscription(value: string): value is TieredExecutionSubscription {
  return (TIERED_EXECUTION_SUBSCRIPTIONS as readonly string[]).includes(value);
}

function isItemKind(value: string): value is XBriefItemKind {
  return (TIERED_EXECUTION_ITEM_KINDS as readonly string[]).includes(value);
}

function isCalloutPolicy(value: string): value is TieredExecutionCalloutPolicy {
  return (TIERED_EXECUTION_CALLOUT_POLICIES as readonly string[]).includes(value);
}

function isCompactionReroutePolicy(value: string): value is TieredExecutionCompactionReroutePolicy {
  return (TIERED_EXECUTION_COMPACTION_REROUTE_POLICIES as readonly string[]).includes(value);
}

function knownModelIds(): Set<string> {
  const ids = new Set<string>();
  for (const provider of Object.values(PROVIDERS)) {
    for (const model of provider.models) ids.add(model);
  }
  return ids;
}

function validateHarness(harness: string, path: string): asserts harness is RuntimeName {
  if (!isRuntimeName(harness)) {
    throw new TieredExecutionConfigError(`${path}.harness '${harness}' is unknown; expected claude-code, ohmypi, codex, acp, kimi-code, opencode, or muse`);
  }
}

interface ResolvedTierModel {
  model: ModelId;
  /** Set when the configured value was a `workhorse:<slot>` ref. */
  modelRef?: string;
}

/**
 * The ref a tier/distribution/supervisor entry declares. A normalized entry
 * carries the dereffed `model` next to its `modelRef`; the ref is the source,
 * so re-validating a normalized config re-derefs it against the current slots.
 */
function declaredModelRef(entry: { model?: unknown; modelRef?: unknown }): string {
  if (typeof entry.modelRef === 'string' && entry.modelRef.startsWith('workhorse:')) return entry.modelRef;
  return entry.model as string;
}

function validateModel(
  entry: { model?: unknown; modelRef?: unknown },
  path: string,
  context: TieredExecutionValidationContext,
): ResolvedTierModel {
  const ref = declaredModelRef(entry);
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new TieredExecutionConfigError(`${path}.model is required`);
  }
  let resolved: string;
  try {
    // PAN-4191: the same ModelRef resolver roles.* use. It throws a plain
    // Error for an undefined slot or the `parent` sentinel; rethrow it as a
    // config error so the load path degrades instead of crashing loadConfig.
    resolved = derefWorkhorse(ref, { workhorses: context.workhorses ?? {} }, `${path}.model`);
  } catch (err) {
    throw new TieredExecutionConfigError(err instanceof Error ? err.message.replace(/^config\.yaml: /, '') : String(err));
  }
  if (!knownModelIds().has(resolved) && !resolved.includes('/')) {
    throw new TieredExecutionConfigError(
      ref === resolved ? `${path}.model '${ref}' is unknown` : `${path}.model '${ref}' resolves to unknown model '${resolved}'`,
    );
  }
  return ref.startsWith('workhorse:') ? { model: resolved as ModelId, modelRef: ref } : { model: resolved as ModelId };
}

function validateModelHarnessPolicy(
  model: string,
  harness: RuntimeName,
  path: string,
  context: TieredExecutionValidationContext,
): void {
  const provider = getProviderForModel(model);
  const authMode = context.providerAuth?.[provider.name as ModelProvider];
  const decision = canUseHarness(harness, model, authMode);
  if (!decision.allowed) {
    throw new TieredExecutionConfigError(`${path} is not allowed: ${decision.reason ?? 'harness policy rejected this model/harness/auth combination'}`);
  }
}

export function normalizeTieredExecutionConfig(config?: Partial<TieredExecutionConfig>): TieredExecutionConfig {
  return {
    enabled: config?.enabled ?? false,
    tiers: config?.tiers ?? {},
    supervisor: config?.supervisor,
    by_kind: config?.by_kind ?? {},
    feed: config?.feed,
    escalation: config?.escalation,
    compaction_reroute: config?.compaction_reroute ?? 'off',
    replay_threshold: config?.replay_threshold ?? 0.5,
  };
}

function validateStringArray(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new TieredExecutionConfigError(`${path} must be an array of strings`);
  }
  return [...value];
}

function validateNonNegativeInteger(value: unknown, path: string, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TieredExecutionConfigError(`${path} must be a non-negative integer`);
  }
  return value as number;
}

function validateFeedConfig(config?: TieredExecutionFeedConfig): ValidatedTieredExecutionFeedConfig {
  const callouts = config?.callouts ?? 'off';
  if (!isCalloutPolicy(callouts)) {
    throw new TieredExecutionConfigError(`tiered_execution.feed.callouts must be one of ${TIERED_EXECUTION_CALLOUT_POLICIES.join(', ')}`);
  }

  const maxDiffBytes = config?.max_diff_bytes ?? null;
  if (
    maxDiffBytes !== null
    && (!Number.isInteger(maxDiffBytes) || maxDiffBytes <= 0)
  ) {
    throw new TieredExecutionConfigError('tiered_execution.feed.max_diff_bytes must be a positive integer or null');
  }

  return {
    callouts,
    exclude: validateStringArray(config?.exclude, 'tiered_execution.feed.exclude'),
    exclude_subjects: validateStringArray(config?.exclude_subjects, 'tiered_execution.feed.exclude_subjects'),
    max_diff_bytes: maxDiffBytes,
  };
}

function validateEscalationConfig(config?: TieredEscalationConfig): ValidatedEscalationConfig {
  return {
    enabled: config?.enabled ?? false,
    retries_at_tier: validateNonNegativeInteger(config?.retries_at_tier, 'tiered_execution.escalation.retries_at_tier', 0),
    max_promotions: validateNonNegativeInteger(config?.max_promotions, 'tiered_execution.escalation.max_promotions', 0),
  };
}

export function validateTieredExecutionConfig(
  rawConfig?: Partial<TieredExecutionConfig>,
  context: TieredExecutionValidationContext = {},
): ValidatedTieredExecutionConfig {
  const config = normalizeTieredExecutionConfig(rawConfig);
  const feed = validateFeedConfig(config.feed);
  const escalation = validateEscalationConfig(config.escalation);
  if (!isCompactionReroutePolicy(config.compaction_reroute ?? 'off')) {
    throw new TieredExecutionConfigError(`tiered_execution.compaction_reroute must be one of ${TIERED_EXECUTION_COMPACTION_REROUTE_POLICIES.join(', ')}`);
  }
  const compactionReroute = config.compaction_reroute ?? 'off';
  const shouldValidateTierTable = config.enabled
    || Object.keys(config.tiers).length > 0
    || Object.keys(config.by_kind ?? {}).length > 0
    || config.supervisor !== undefined;
  if (!shouldValidateTierTable) {
    return { ...DEFAULT_TIERED_EXECUTION_CONFIG, feed, escalation, compaction_reroute: compactionReroute };
  }

  if (typeof config.replay_threshold !== 'number' || config.replay_threshold <= 0 || config.replay_threshold > 1) {
    throw new TieredExecutionConfigError('tiered_execution.replay_threshold must be a number > 0 and <= 1');
  }

  const difficultyOwners: Partial<Record<XBriefDifficulty, string[]>> = {};
  const normalizedTiers: Record<string, TierDefinition> = {};

  for (const [tierName, tier] of Object.entries(config.tiers)) {
    const path = `tiered_execution.tiers.${tierName}`;

    const rawDistribution = (tier as { distribution?: unknown }).distribution;
    let normalizedDistribution: TierDistributionEntry[] | undefined;
    let model: string;
    let modelRef: string | undefined;
    let harness: RuntimeName;
    if (rawDistribution !== undefined) {
      if (!Array.isArray(rawDistribution) || rawDistribution.length === 0) {
        throw new TieredExecutionConfigError(`${path}.distribution must be a non-empty array of {model, harness, weight}`);
      }
      normalizedDistribution = rawDistribution.map((entry, index) => {
        const entryPath = `${path}.distribution[${index}]`;
        const candidate = entry as Partial<TierDistributionEntry>;
        validateHarness(candidate.harness as RuntimeName, entryPath);
        const entryModel = validateModel(candidate, entryPath, context);
        validateModelHarnessPolicy(entryModel.model, candidate.harness as RuntimeName, entryPath, context);
        if (!Number.isInteger(candidate.weight) || (candidate.weight as number) <= 0) {
          throw new TieredExecutionConfigError(`${entryPath}.weight must be a positive integer`);
        }
        return { ...entryModel, harness: candidate.harness as RuntimeName, weight: candidate.weight as number };
      });
      const total = normalizedDistribution.reduce((sum, entry) => sum + entry.weight, 0);
      if (total !== 100) {
        throw new TieredExecutionConfigError(`${path}.distribution weights must total exactly 100 (got ${total})`);
      }
      const representative = normalizedDistribution.reduce((best, entry) => (entry.weight > best.weight ? entry : best));
      // Idempotent re-validation: a normalized config carries the max-weight
      // representative as model/harness alongside the distribution. Accept
      // model/harness that MATCH the representative; reject a genuine
      // conflicting declaration of both. Compare the declared refs, so a
      // workhorse-backed representative matches after its slot re-derefs.
      if (
        (tier.model !== undefined && declaredModelRef(tier) !== (representative.modelRef ?? representative.model))
        || (tier.harness !== undefined && tier.harness !== representative.harness)
      ) {
        throw new TieredExecutionConfigError(`${path} must declare either model/harness or distribution, not both`);
      }
      model = representative.model;
      modelRef = representative.modelRef;
      harness = representative.harness;
    } else {
      validateHarness(tier.harness, path);
      ({ model, modelRef } = validateModel(tier, path, context));
      validateModelHarnessPolicy(model, tier.harness, path, context);
      harness = tier.harness;
    }

    if (!Array.isArray(tier.difficulties) || tier.difficulties.length === 0) {
      throw new TieredExecutionConfigError(`${path}.difficulties must contain at least one difficulty`);
    }

    const difficulties: XBriefDifficulty[] = [];
    for (const difficulty of tier.difficulties) {
      if (!isDifficulty(difficulty)) {
        throw new TieredExecutionConfigError(`${path}.difficulties contains unknown difficulty '${difficulty as string}'`);
      }
      difficulties.push(difficulty);
      difficultyOwners[difficulty] = [...(difficultyOwners[difficulty] ?? []), tierName];
    }

    normalizedTiers[tierName] = { model, ...(modelRef ? { modelRef } : {}), harness, difficulties, ...(normalizedDistribution ? { distribution: normalizedDistribution } : {}) };
  }

  const difficultyToTier: Partial<Record<XBriefDifficulty, string>> = {};
  for (const difficulty of TIERED_EXECUTION_DIFFICULTIES) {
    const owners = difficultyOwners[difficulty] ?? [];
    if (owners.length === 0) {
      throw new TieredExecutionConfigError(`tiered_execution difficulty '${difficulty}' is not mapped to any tier`);
    }
    if (owners.length > 1) {
      throw new TieredExecutionConfigError(`tiered_execution difficulty '${difficulty}' is mapped to multiple tiers: ${owners.join(', ')}`);
    }
    difficultyToTier[difficulty] = owners[0];
  }

  const byKind: Partial<Record<XBriefItemKind, string>> = {};
  for (const [kind, tierName] of Object.entries(config.by_kind ?? {})) {
    if (!isItemKind(kind)) {
      throw new TieredExecutionConfigError(`tiered_execution.by_kind contains unknown item kind '${kind}'`);
    }
    if (!normalizedTiers[tierName]) {
      throw new TieredExecutionConfigError(`tiered_execution.by_kind.${kind} references unknown tier '${tierName}'`);
    }
    byKind[kind] = tierName;
  }

  if (!config.supervisor) {
    throw new TieredExecutionConfigError('tiered_execution.supervisor is required when tiered execution tiers are configured');
  }

  validateHarness(config.supervisor.harness, 'tiered_execution.supervisor');
  const supervisorModel = validateModel(config.supervisor, 'tiered_execution.supervisor', context);
  validateModelHarnessPolicy(supervisorModel.model, config.supervisor.harness, 'tiered_execution.supervisor', context);
  if (!isSubscription(config.supervisor.subscribe)) {
    throw new TieredExecutionConfigError(`tiered_execution.supervisor.subscribe must be one of ${TIERED_EXECUTION_SUBSCRIPTIONS.join(', ')}`);
  }

  return {
    enabled: config.enabled,
    tiers: normalizedTiers,
    supervisor: {
      ...supervisorModel,
      harness: config.supervisor.harness,
      subscribe: config.supervisor.subscribe,
      // supervisor.owns_inspection was retired with the inspect gate (#3927).
      // A config.yaml may still carry it; building the supervisor from named
      // fields drops it here, so the next Settings save removes it from disk.
    },
    by_kind: byKind,
    byKind,
    feed,
    escalation,
    compaction_reroute: compactionReroute,
    replay_threshold: config.replay_threshold,
    difficultyToTier,
  };
}

/** PAN-4191: one tier (or distribution entry) with its declared ref and the model it launches. */
export interface EffectiveTierRow {
  tierName: string;
  /** What config.yaml declares: a `workhorse:<slot>` ref or a literal model id. */
  ref: string;
  /** The concrete model the tier launches. */
  model: string;
  harness: RuntimeName;
  difficulties: XBriefDifficulty[];
  /** Distribution weight, when the row is one entry of a distribution tier. */
  weight?: number;
  /** True when tiered execution is on and this row launches a different model than roles.work. */
  overridesWork: boolean;
}

export interface EffectiveTierTable {
  enabled: boolean;
  /** roles.work's effective model (representative pick of a distribution). */
  workModel: string;
  rows: EffectiveTierRow[];
}

/**
 * PAN-4191: the effective model per tier, and whether the tier table shadows
 * roles.work. While tiered execution is on, a planned issue's work agent takes
 * its tier's model, not roles.work; `pan admin config tiers` prints this so
 * that precedence is visible.
 */
export function effectiveTierTable(
  tiered: Pick<TieredExecutionConfig, 'enabled' | 'tiers'>,
  workModel: string,
): EffectiveTierTable {
  const rows: EffectiveTierRow[] = [];
  for (const [tierName, tier] of Object.entries(tiered.tiers)) {
    const entries: Array<{ model: string; modelRef?: string; harness: RuntimeName; weight?: number }> =
      tier.distribution ?? [{ model: tier.model, modelRef: tier.modelRef, harness: tier.harness }];
    for (const entry of entries) {
      rows.push({
        tierName,
        ref: entry.modelRef ?? entry.model,
        model: entry.model,
        harness: entry.harness,
        difficulties: tier.difficulties,
        ...(entry.weight !== undefined ? { weight: entry.weight } : {}),
        overridesWork: tiered.enabled && entry.model !== workModel,
      });
    }
  }
  return { enabled: tiered.enabled, workModel, rows };
}
