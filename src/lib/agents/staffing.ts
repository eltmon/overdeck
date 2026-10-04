/**
 * PAN-2397 W1 — Always Tiered: the single staffing resolver.
 *
 * Every bead dispatch resolves WHO runs it through this one function. When an
 * explicit tier table is enabled (globally or via the plan's per-issue
 * override), staffing comes from the tier resolution chain. Otherwise staffing
 * comes from the IMPLICIT tier table: a degenerate one-tier world whose
 * `default` tier is exactly today's roles.work resolution (same resolveModel
 * call, same spawnKey, so Role-Models work distributions keep their
 * deterministic per-spawn behavior). "Non-tiered execution" is therefore not
 * a separate code path — it is this degenerate configuration.
 *
 * Fallthrough rule (D-explicit-gap): when the explicit table cannot place a
 * bead (no difficulty, no by_kind match, no per-bead override — the
 * ResolveTierError case), staffing falls through to the implicit tier. That
 * reproduces the historical behavior where such beads ran on the role-default
 * model, without callers special-casing it.
 */

import type { EffortLevel, EffortSource } from '@overdeck/contracts';
import type { RuntimeName } from '../runtimes/types.js';
import type { XBriefItem } from '../xbrief/types.js';
import { loadConfigSync as loadYamlConfig } from '../config-yaml.js';
import type { NormalizedConfig } from '../config-yaml/schema.js';
import { resolveModel } from '../config-yaml/roles.js';
import { requireModelOverride } from '../model-validation.js';
import { getBuiltInDefaultHarness, getProviderForModel } from '../providers.js';
import { fmix32, fnv1a32 } from '../config-yaml/percent.js';
import type { TierOverridesMap } from '../xbrief/io.js';
import { applyEffectiveDifficulty } from './tier-escalation.js';
import { resolveTier } from './resolve-tier.js';
import { resolveEffort } from './resolve-effort.js';
import { resolveTieredExecutionEnabled, type TierDistributionEntry } from './tier-table.js';

export const IMPLICIT_TIER_NAME = 'default';

export interface Staffing {
  tierName: string;
  model: string;
  harness: RuntimeName;
  /** true when staffing came from the implicit roles.work-derived tier. */
  implicit: boolean;
  /** Reasoning effort for the staffed model (PAN-4257), via resolveEffort's precedence chain. */
  effort: EffortLevel;
  /** Which precedence layer supplied {@link Staffing.effort}. */
  effortSource: EffortSource;
}

export interface ResolveStaffingOptions {
  /** plan.metadata — carries the per-issue tiered_execution override. */
  planMetadata?: { [key: string]: unknown };
  /**
   * Deterministic key for Role-Models percent distributions in the implicit
   * tier (spawn.ts uses `${role}:${issueId}`). Required for byte-identical
   * behavior with the historical determineModel path.
   */
  spawnKey?: string;
  /** Injectable config for tests; defaults to the loaded config. */
  config?: Pick<NormalizedConfig, 'roles' | 'workhorses' | 'tieredExecution' | 'providerHarnesses'>;
  /** Issue whose durable work-model override should be applied. */
  issueId?: string;
  /**
   * Recorded tier promotions for the workspace (`readTierOverrides`). Applied
   * to the item's difficulty before `resolveTier` so a promoted item staffs at
   * its promoted tier (PAN-3858: promotions must reach live staffing).
   */
  tierOverrides?: TierOverridesMap;
}

/** Provider-default harness for a model (PAN-1984: harness is derived from the
 * model's provider — per-provider setting else built-in default). */
function providerDefaultHarnessSync(
  model: string,
  config: Pick<NormalizedConfig, 'providerHarnesses'>,
): RuntimeName {
  const provider = getProviderForModel(model).name;
  return config.providerHarnesses?.[provider] ?? getBuiltInDefaultHarness(provider);
}

/** Resolves the effort for a staffed bead via resolveEffort's precedence
 * chain (PAN-4257): explicit > item > plan > tier > sub-role > role >
 * project > default. Always resolves against role 'work'. */
function staffedEffort(
  item: Pick<XBriefItem, 'metadata'> | undefined,
  tierName: string | undefined,
  model: string,
  harness: RuntimeName,
  config: Pick<NormalizedConfig, 'tieredExecution' | 'roles'>,
  options: ResolveStaffingOptions,
): Pick<Staffing, 'effort' | 'effortSource'> {
  const resolved = resolveEffort({
    itemEffort: item?.metadata?.effort,
    planEffort: options.planMetadata?.effort,
    tierName,
    role: 'work',
    issueId: options.issueId,
    model,
    harness,
    config,
  });
  return { effort: resolved.effort, effortSource: resolved.source };
}

/** The implicit tier: roles.work resolution as a Staffing. Fails loudly when
 * the work role is unresolvable — never a hardcoded fallback. */
export function resolveImplicitStaffing(
  config: Pick<NormalizedConfig, 'roles' | 'workhorses' | 'providerHarnesses' | 'tieredExecution'>,
  spawnKey?: string,
  item?: Pick<XBriefItem, 'metadata'>,
  options: ResolveStaffingOptions = {},
): Staffing {
  const model = requireModelOverride(resolveModel('work', undefined, config, spawnKey));
  const harness = providerDefaultHarnessSync(model, config);
  return {
    tierName: IMPLICIT_TIER_NAME,
    model,
    harness,
    implicit: true,
    ...staffedEffort(item, undefined, model, harness, config, options),
  };
}

/**
 * THE staffing resolver (FR-1). Explicit tier table when enabled for the
 * issue; implicit roles.work tier otherwise — and as the fallthrough when the
 * explicit table cannot place the bead.
 */
export function resolveStaffing(
  item: Pick<XBriefItem, 'id' | 'title' | 'metadata'>,
  options: ResolveStaffingOptions = {},
): Staffing {
  const config = options.config ?? loadYamlConfig().config;
  // PAN-3917: the per-issue work-model override lived only on the deleted
  // pipeline record (Appendix A.2) with no live-derivable replacement — an
  // operator-set override, not something git/tracker/PR/liveness can
  // reconstruct. A one-off model for a single session is passed at spawn
  // time instead (`pan start --model`), which flows in via metadata.model.
  const tiered = config.tieredExecution;

  if (tiered && resolveTieredExecutionEnabled(tiered, options.planMetadata)) {
    try {
      const effectiveItem = options.tierOverrides
        ? applyEffectiveDifficulty(item, options.tierOverrides)
        : item;
      const tier = resolveTier(effectiveItem, tiered);
      // PAN-2391: a distribution tier spreads beads across weighted
      // model+harness entries. Selection is deterministic per bead so
      // replay/re-resolution always lands on the same entry. A per-bead
      // metadata.model override never reaches here with the tier's name
      // (resolveTier returns the override pseudo-tier), so overrides win.
      const distribution = tiered.tiers?.[tier.tierName]?.distribution;
      if (distribution && distribution.length > 0) {
        const entry = pickDistributionEntry(distribution, `${options.spawnKey ?? ''}:${item.id}`);
        return {
          tierName: tier.tierName,
          model: entry.model,
          harness: entry.harness,
          implicit: false,
          ...staffedEffort(effectiveItem, tier.tierName, entry.model, entry.harness, config, options),
        };
      }
      return {
        tierName: tier.tierName,
        model: tier.model,
        harness: tier.harness,
        implicit: false,
        ...staffedEffort(effectiveItem, tier.tierName, tier.model, tier.harness, config, options),
      };
    } catch {
      // Explicit table cannot place this bead — fall through to the implicit
      // tier (historical role-default behavior, now uniform).
    }
  }

  return resolveImplicitStaffing(config, options.spawnKey, item, options);
}

/** Deterministic weighted pick (D6): FNV-1a of the selection key → bucket in
 * [0, 100). Same key always selects the same entry. */
export function pickDistributionEntry(
  entries: readonly TierDistributionEntry[],
  selectionKey: string,
): TierDistributionEntry {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const bucket = fmix32(fnv1a32(selectionKey)) % total;
  let cursor = 0;
  for (const entry of entries) {
    cursor += entry.weight;
    if (bucket < cursor) return entry;
  }
  return entries[entries.length - 1]!;
}
