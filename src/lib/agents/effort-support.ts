/**
 * Effort validation/clamping leaf module. Deliberately depends only on
 * @overdeck/contracts, ../model-capabilities.js, and (type-only) on
 * ../runtimes/types.js — never on config-yaml, projects, or resolve-effort.
 * config-yaml.ts re-exports config-yaml/roles.js, so a resolve-effort import
 * from here would create a cycle; this leaf lets config-yaml/roles.ts,
 * settings-api.ts and tier-table.ts validate effort without one.
 */
import { EFFORT_LEVELS, compareEffort, getHarnessBehavior, isEffortLevel } from '@overdeck/contracts';
import type { EffortLevel } from '@overdeck/contracts';
import { getModelEffortLevels } from '../model-capabilities.js';
import type { RuntimeName } from '../runtimes/types.js';

/**
 * Effort levels a model+harness pair jointly accept, in EFFORT_LEVELS order.
 * A model or harness with no known restriction (unregistered model, or a
 * harness whose `effortLevels` is undefined/empty) contributes "all five"
 * to the intersection.
 */
export function supportedEffortLevels(model?: string, harness?: RuntimeName): readonly EffortLevel[] {
  const modelLevels = model ? getModelEffortLevels(model) : undefined;
  const harnessLevels = harness ? getHarnessBehavior(harness).effortLevels : undefined;
  const effectiveModel = modelLevels && modelLevels.length > 0 ? modelLevels : EFFORT_LEVELS;
  const effectiveHarness = harnessLevels && harnessLevels.length > 0 ? harnessLevels : EFFORT_LEVELS;
  return EFFORT_LEVELS.filter((level) => effectiveModel.includes(level) && effectiveHarness.includes(level));
}

export interface ClampEffortResult {
  effort: EffortLevel;
  clamped: boolean;
  warning?: string;
}

/**
 * D6 clamping rule: keep `requested` if the model/harness pair supports it;
 * otherwise fall to the highest supported level below it, or, when nothing
 * ranks below it, the lowest supported level. When the supported set is
 * empty (a model and harness restriction with no overlap), `requested` is
 * kept as-is and flagged with a warning rather than dropped.
 */
export function clampEffort(requested: EffortLevel, model?: string, harness?: RuntimeName): ClampEffortResult {
  const supported = supportedEffortLevels(model, harness);
  if (supported.includes(requested)) {
    return { effort: requested, clamped: false };
  }

  const label = [model, harness].filter((part): part is string => Boolean(part)).join('/');

  if (supported.length === 0) {
    return {
      effort: requested,
      clamped: false,
      warning: `Effort '${requested}' is not supported by ${label}; using '${requested}'.`,
    };
  }

  const below = supported.filter((level) => compareEffort(level, requested) < 0);
  const chosen = below.length > 0 ? below[below.length - 1] : supported[0];

  return {
    effort: chosen,
    clamped: true,
    warning: `Effort '${requested}' is not supported by ${label}; using '${chosen}'.`,
  };
}

/**
 * Config-validation errors for an `effort` field, byte-identical to the
 * messages settings-api.ts has produced historically. `models` are the
 * already-resolved model ids the field's role/sub-role/tier resolves to
 * (multiple for a weighted distribution); each is checked independently.
 */
export function effortConfigErrors(fieldPath: string, effort: unknown, models: readonly string[] = []): string[] {
  if (effort === undefined) return [];

  if (typeof effort !== 'string' || !isEffortLevel(effort)) {
    return [`${fieldPath}.effort must be one of ${EFFORT_LEVELS.join(', ')}`];
  }

  const errors: string[] = [];
  for (const model of models) {
    const supported = getModelEffortLevels(model);
    if (supported !== undefined && supported.length > 0 && !supported.includes(effort)) {
      errors.push(`${fieldPath}.effort '${effort}' is not supported by ${model} (supported: ${supported.join(', ')})`);
    }
  }
  return errors;
}
