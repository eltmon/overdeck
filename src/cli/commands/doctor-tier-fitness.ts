// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-inotify.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}
import { loadConfigSync } from '../../lib/config-yaml/load.js';
import { TIERED_EXECUTION_DIFFICULTIES } from '../../lib/agents/tier-table.js';
import { resolveModel } from '../../lib/config-yaml/roles.js';
import { requireModelOverrideSync } from '../../lib/model-validation.js';
import { checkTierFitness, type TierFitnessWarning } from '../../lib/agents/tier-fitness.js';
import { buildTierFitnessContextSync } from '../../lib/agents/tier-fitness-context.js';

export interface TierFitnessDoctorDeps {
  loadConfig: () => ReturnType<typeof loadConfigSync>;
}

const FIX =
  'Adjust the tier model in Settings › Tiered Execution (warning only — a cheap model may be deliberate). With tiered execution off, enable it to route expert items to a frontier tier.';

/** PAN-3842: warn when a tier's model class does not fit its difficulty band. */
export function checkTierFitnessConfig(deps: TierFitnessDoctorDeps = { loadConfig: loadConfigSync }): CheckResult {
  const { config } = deps.loadConfig();
  // PAN-2395: an invalid tiered_execution block never throws at load; it is
  // degraded to disabled and the reason is surfaced here. That is the error row.
  if (config.tieredExecutionInvalid) {
    return {
      name: 'Tiered execution',
      status: 'error',
      message: `tiered_execution is invalid and has been disabled: ${config.tieredExecutionInvalid.reason}`,
      fix: 'Fix ~/.overdeck/config.yaml tiered_execution and re-run pan doctor',
    };
  }
  const tiered = config.tieredExecution;
  const ctx = buildTierFitnessContextSync(config);
  let warnings: TierFitnessWarning[];
  if (tiered.enabled) {
    warnings = checkTierFitness(tiered, ctx);
  } else {
    // D11: implicit roles.work tier owns every difficulty. Same resolution pair
    // as resolveImplicitStaffing (staffing.ts:83) — fails loudly, never falls back.
    let model: string;
    try {
      model = requireModelOverrideSync(resolveModel('work', undefined, config));
    } catch (error) {
      return {
        name: 'Tiered execution',
        status: 'error',
        message: `roles.work.model could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
        fix: 'Set roles.work.model in ~/.overdeck/config.yaml',
      };
    }
    warnings = checkTierFitness({ tiers: { default: { model, difficulties: [...TIERED_EXECUTION_DIFFICULTIES] } } }, ctx).map((w) => ({
      ...w,
      path: 'roles.work.model',
      message: w.message.replace('tiered_execution.tiers.default', 'roles.work.model'),
    }));
  }
  if (warnings.length === 0) {
    return {
      name: 'Tiered execution',
      status: 'ok',
      message: tiered.enabled ? `${Object.keys(tiered.tiers).length} tiers fit their difficulties` : 'disabled; roles.work fits every difficulty',
    };
  }
  return { name: 'Tiered execution', status: 'warn', message: warnings.map((w) => w.message).join('\n    '), fix: FIX };
}
