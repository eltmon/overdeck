/**
 * Plan critic model resolution (PAN-4341 FR-9).
 *
 * The critic's model comes only from `roles.plan.sub.critic.model`. There is
 * no default and no fallback: every default workhorse is a Claude model, so a
 * default would put the critic in the planner's family. `resolveModel` is not
 * used because it falls back to the parent role's model when the sub-role is
 * unset, which would hide "not configured".
 */
import { derefWorkhorse } from '../config-yaml/roles.js';
import type { NormalizedConfig } from '../config-yaml/schema.js';
import { resolveHarness } from '../harness-resolve.js';
import { getProviderForModel } from '../providers.js';
import type { RuntimeName } from '../runtimes/types.js';
import { toTelemetryModelFamily } from '../telemetry/pipeline.js';

export const PLAN_CRITIC_MODEL_SETTING = 'roles.plan.sub.critic.model';

/**
 * The vendor lineage used as the decorrelation axis. Known families come from
 * `toTelemetryModelFamily`; `other` models are told apart by provider, and a
 * model no provider knows gets its own `unknown:<model>` family.
 */
export function familyOf(model: string): string {
  const family = toTelemetryModelFamily(model);
  if (family !== 'other') return family;
  try {
    return `provider:${getProviderForModel(model).name}`;
  } catch {
    return `unknown:${model}`;
  }
}

export type PlanCriticResolution =
  | { ok: true; model: string; harness: RuntimeName; family: string; plannerFamily: string }
  | { ok: false; reason: 'critic-not-configured' | 'critic-same-family'; message: string };

export async function resolvePlanCritic(input: {
  plannerModel: string;
  config: Pick<NormalizedConfig, 'roles' | 'workhorses'>;
  resolveHarnessImpl?: (model: string) => Promise<RuntimeName>;
}): Promise<PlanCriticResolution> {
  const plannerFamily = familyOf(input.plannerModel);
  const ref = input.config.roles?.plan?.sub?.critic?.model;
  if (!ref) {
    return {
      ok: false,
      reason: 'critic-not-configured',
      message:
        `Plan critic not configured: set ${PLAN_CRITIC_MODEL_SETTING} in ~/.overdeck/config.yaml ` +
        `to a model outside the planner's family (${plannerFamily}, planner model ${input.plannerModel}).`,
    };
  }

  const model = derefWorkhorse(ref, input.config, PLAN_CRITIC_MODEL_SETTING);
  const family = familyOf(model);
  if (family === plannerFamily) {
    return {
      ok: false,
      reason: 'critic-same-family',
      message:
        `Plan critic ${model} (family ${family}) is in the planner's family (${plannerFamily}, planner model ` +
        `${input.plannerModel}); set ${PLAN_CRITIC_MODEL_SETTING} to a model from a different family.`,
    };
  }

  const resolveHarnessImpl = input.resolveHarnessImpl ?? ((critic: string) => resolveHarness({ model: critic }));
  const harness = await resolveHarnessImpl(model);
  return { ok: true, model, harness, family, plannerFamily };
}
