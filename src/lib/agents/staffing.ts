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

import type { RuntimeName } from '../runtimes/types.js';
import type { VBriefItem } from '../vbrief/types.js';
import { loadConfigSync as loadYamlConfig } from '../config-yaml.js';
import type { NormalizedConfig } from '../config-yaml/schema.js';
import { resolveModel } from '../config-yaml/roles.js';
import { requireModelOverrideSync } from '../model-validation.js';
import { getBuiltInDefaultHarness, getProviderForModelSync } from '../providers.js';
import { resolveTier } from './resolve-tier.js';
import { resolveTieredExecutionEnabled } from './tier-table.js';

export const IMPLICIT_TIER_NAME = 'default';

export interface Staffing {
  tierName: string;
  model: string;
  harness: RuntimeName;
  /** true when staffing came from the implicit roles.work-derived tier. */
  implicit: boolean;
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
}

/** Provider-default harness for a model (PAN-1984: harness is derived from the
 * model's provider — per-provider setting else built-in default). */
export function providerDefaultHarnessSync(
  model: string,
  config: Pick<NormalizedConfig, 'providerHarnesses'>,
): RuntimeName {
  const provider = getProviderForModelSync(model).name;
  return config.providerHarnesses?.[provider] ?? getBuiltInDefaultHarness(provider);
}

/** The implicit tier: roles.work resolution as a Staffing. Fails loudly when
 * the work role is unresolvable — never a hardcoded fallback. */
export function resolveImplicitStaffing(
  config: Pick<NormalizedConfig, 'roles' | 'workhorses' | 'providerHarnesses'>,
  spawnKey?: string,
): Staffing {
  const model = requireModelOverrideSync(resolveModel('work', undefined, config, spawnKey));
  return {
    tierName: IMPLICIT_TIER_NAME,
    model,
    harness: providerDefaultHarnessSync(model, config),
    implicit: true,
  };
}

/**
 * THE staffing resolver (FR-1). Explicit tier table when enabled for the
 * issue; implicit roles.work tier otherwise — and as the fallthrough when the
 * explicit table cannot place the bead.
 */
export function resolveStaffing(
  item: Pick<VBriefItem, 'id' | 'title' | 'metadata'>,
  options: ResolveStaffingOptions = {},
): Staffing {
  const config = options.config ?? loadYamlConfig().config;
  const tiered = config.tieredExecution;

  if (tiered && resolveTieredExecutionEnabled(tiered, options.planMetadata)) {
    try {
      const tier = resolveTier(item, tiered);
      return { tierName: tier.tierName, model: tier.model, harness: tier.harness, implicit: false };
    } catch {
      // Explicit table cannot place this bead — fall through to the implicit
      // tier (historical role-default behavior, now uniform).
    }
  }

  return resolveImplicitStaffing(config, options.spawnKey);
}
