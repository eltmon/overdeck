import type { XBriefDifficulty } from '../xbrief/types.js';
import type { ModelCapabilityClass } from '../model-capability-class.js';
import { CONFIGURABLE_PROVIDER_SET } from '../configurable-providers.js';

// §5.2 Difficulty bands
export const CAPABILITY_CLASS_RANK: Record<ModelCapabilityClass, number> = { small: 0, workhorse: 1, frontier: 2 };

export const DIFFICULTY_CLASS_BANDS: Record<XBriefDifficulty, { min: ModelCapabilityClass; max: ModelCapabilityClass }> = {
  trivial: { min: 'small', max: 'workhorse' },
  simple: { min: 'small', max: 'workhorse' },
  medium: { min: 'workhorse', max: 'frontier' },
  complex: { min: 'workhorse', max: 'frontier' },
  expert: { min: 'frontier', max: 'frontier' },
};

// §5.3 Warning shape
export type TierFitnessCode =
  | 'underpowered' // class rank < band.min for at least one owned difficulty
  | 'overpowered' // class rank > band.max for EVERY owned difficulty (cost)
  | 'unknown-model' // model id not in ctx.knownModelIds
  | 'provider-not-enabled' // ctx.enabledProviders is set and lacks providerOf(model)
  | 'supervisor-underpowered' // supervisor class === 'small'
  | 'harness-unverified'; // reserved (D7) — never emitted in this issue

export interface TierFitnessWarning {
  code: TierFitnessCode;
  /** 'tiered_execution.tiers.<name>' | 'tiered_execution.supervisor' | 'roles.work.model' */
  path: string;
  tierName: string; // '<name>' | 'supervisor' | 'default'
  model: string;
  harness?: string;
  difficulties: XBriefDifficulty[];
  /** Full operator-facing sentence, starts with `path`. */
  message: string;
}

export interface TierFitnessContext {
  knownModelIds: ReadonlySet<string>;
  classOf: (model: string) => ModelCapabilityClass | undefined;
  providerOf: (model: string) => string | undefined;
  /** undefined ⇒ skip the provider check (frontend without provider info). */
  enabledProviders?: ReadonlySet<string>;
  /**
   * Providers the operator can actually enable. Defaults to
   * CONFIGURABLE_PROVIDERS; both callers pass that set.
   *
   * PAN-3842 (adjudicated F-1): `provider-not-enabled` names "Settings ›
   * Providers" as the remedy, so it may only fire for a provider with a
   * control there. Environment-only providers (xai, groq, cerebras, mistral,
   * quantumllama) have no YAML key and no merge branch that can ever add them
   * to `enabledProviders`, so the warning was permanent and unclearable.
   */
  configurableProviders?: ReadonlySet<string>;
}

/** Structural input so both lib and frontend config shapes fit. */
export interface TierFitnessConfig {
  tiers: Record<
    string,
    {
      model: string;
      harness?: string;
      difficulties: XBriefDifficulty[];
      distribution?: Array<{ model: string; harness?: string; weight: number }>;
    }
  >;
  supervisor?: { model: string; harness?: string };
}

function warn(
  code: TierFitnessCode,
  path: string,
  tierName: string,
  model: string,
  harness: string | undefined,
  difficulties: XBriefDifficulty[],
  message: string,
): TierFitnessWarning {
  return { code, path, tierName, model, harness, difficulties, message };
}

/**
 * The requirement clause of an `underpowered` message.
 *
 * One requirement across every failing difficulty keeps the original sentence
 * verbatim. When they differ, each group states its OWN requirement: a single
 * max-requirement sentence after a mixed list read as though every difficulty
 * needed the strongest class — `medium, complex, expert` on a small model
 * implied `medium` needs frontier-class, when medium needs workhorse-class.
 * Strongest group first. Classification is unaffected; the max still decides
 * whether the warning fires at all.
 */
function underpoweredDetail(bad: XBriefDifficulty[]): string {
  const byNeed = new Map<ModelCapabilityClass, XBriefDifficulty[]>();
  for (const difficulty of bad) {
    const need = DIFFICULTY_CLASS_BANDS[difficulty].min;
    const group = byNeed.get(need);
    if (group) group.push(difficulty);
    else byNeed.set(need, [difficulty]);
  }
  if (byNeed.size === 1) {
    const [needed] = [...byNeed.keys()];
    return `items at that difficulty need at least ${needed}-class`;
  }
  return [...byNeed.entries()]
    .sort(([a], [b]) => CAPABILITY_CLASS_RANK[b] - CAPABILITY_CLASS_RANK[a])
    .map(([need, group]) => `${group.join(', ')} ${group.length === 1 ? 'needs' : 'need'} at least ${need}-class`)
    .join('; ');
}

/**
 * Whether to warn that `provider` is not enabled.
 *
 * Silent when the caller supplied no `enabledProviders` (frontend contexts
 * without provider info), when the model has no known provider, and — PAN-3842
 * F-1 — when the provider has no enable control for the operator to use. The
 * message points at Settings › Providers, so firing it for an environment-only
 * provider produces advice that cannot be followed.
 */
function providerIsDisabled(provider: string | undefined, ctx: TierFitnessContext): provider is string {
  if (ctx.enabledProviders === undefined || provider === undefined) return false;
  const configurable = ctx.configurableProviders ?? CONFIGURABLE_PROVIDER_SET;
  if (!configurable.has(provider)) return false;
  return !ctx.enabledProviders.has(provider);
}

/** Steps 1–5 of the per-entry algorithm for one staffed (model, harness). */
function checkEntry(
  entry: { model: string; harness?: string },
  path: string,
  tierName: string,
  difficulties: XBriefDifficulty[],
  ctx: TierFitnessContext,
): TierFitnessWarning[] {
  const { model, harness } = entry;
  if (!ctx.knownModelIds.has(model)) {
    return [warn('unknown-model', path, tierName, model, harness, difficulties, `${path}: ${model} is not in the model catalog`)];
  }
  const warnings: TierFitnessWarning[] = [];
  const provider = ctx.providerOf(model);
  if (providerIsDisabled(provider, ctx)) {
    warnings.push(
      warn(
        'provider-not-enabled',
        path,
        tierName,
        model,
        harness,
        difficulties,
        `${path}: ${model} belongs to provider '${provider}', which is not enabled in Settings › Providers`,
      ),
    );
  }
  const cls = ctx.classOf(model);
  if (cls === undefined) return warnings; // unclassified: stop after the provider check (D5)
  const rank = CAPABILITY_CLASS_RANK[cls];
  const bad = difficulties.filter((d) => rank < CAPABILITY_CLASS_RANK[DIFFICULTY_CLASS_BANDS[d].min]);
  if (bad.length > 0) {
    warnings.push(
      warn(
        'underpowered',
        path,
        tierName,
        model,
        harness,
        bad,
        `${path}: ${model} is a ${cls}-class model but this tier owns ${bad.join(', ')} — ${underpoweredDetail(bad)}`,
      ),
    );
  } else if (difficulties.length > 0 && difficulties.every((d) => rank > CAPABILITY_CLASS_RANK[DIFFICULTY_CLASS_BANDS[d].max])) {
    const maxAllowed = DIFFICULTY_CLASS_BANDS[difficulties[0]].max;
    warnings.push(
      warn(
        'overpowered',
        path,
        tierName,
        model,
        harness,
        difficulties,
        `${path}: ${model} is a frontier-class model but this tier only owns ${difficulties.join(', ')} — a ${maxAllowed}-class model would cost less`,
      ),
    );
  }
  return warnings;
}

export function checkTierFitness(config: TierFitnessConfig, ctx: TierFitnessContext): TierFitnessWarning[] {
  const warnings: TierFitnessWarning[] = [];
  for (const [tierName, tier] of Object.entries(config.tiers)) {
    const path = `tiered_execution.tiers.${tierName}`;
    const entries = tier.distribution ?? [{ model: tier.model, harness: tier.harness, weight: 100 }];
    for (const entry of entries) {
      warnings.push(...checkEntry(entry, path, tierName, tier.difficulties, ctx));
    }
  }
  if (config.supervisor) {
    const { model, harness } = config.supervisor;
    const path = 'tiered_execution.supervisor';
    if (!ctx.knownModelIds.has(model)) {
      warnings.push(warn('unknown-model', path, 'supervisor', model, harness, [], `${path}: ${model} is not in the model catalog`));
    } else {
      const provider = ctx.providerOf(model);
      if (providerIsDisabled(provider, ctx)) {
        warnings.push(
          warn(
            'provider-not-enabled',
            path,
            'supervisor',
            model,
            harness,
            [],
            `${path}: ${model} belongs to provider '${provider}', which is not enabled in Settings › Providers`,
          ),
        );
      }
      const cls = ctx.classOf(model);
      if (cls === 'small') {
        warnings.push(
          warn(
            'supervisor-underpowered',
            path,
            'supervisor',
            model,
            harness,
            [],
            `tiered_execution.supervisor: ${model} is a small-class model; the supervisor reviews every tier's commits and should be workhorse-class or better`,
          ),
        );
      }
    }
  }
  return warnings;
}

/** One staffed (model, harness) against a set of difficulties — the spawn-time check. */
export function checkStaffingFitness(
  staffing: { tierName: string; model: string; harness?: string; path?: string },
  difficulties: XBriefDifficulty[],
  ctx: TierFitnessContext,
): TierFitnessWarning[] {
  const path = staffing.path ?? `tiered_execution.tiers.${staffing.tierName}`;
  // Only 'underpowered' | 'unknown-model' | 'provider-not-enabled' apply to a
  // single staffing; the overpowered cost check is a tier-shape property.
  return checkEntry({ model: staffing.model, harness: staffing.harness }, path, staffing.tierName, difficulties, ctx).filter(
    (w) => w.code !== 'overpowered',
  );
}
