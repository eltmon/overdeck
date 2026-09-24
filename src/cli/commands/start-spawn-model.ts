/**
 * Spawn-model resolution for `pan start` (PAN-2410, PAN-3857).
 *
 * Only two inputs may choose the spawn model: an explicit `--model` flag and,
 * for a plain (non-`--fresh`) restart, the prior agent's model as resume
 * continuity. A stored `record.workModel` is NOT read back here — staffing
 * honors it through the issue-override tier in resolveStaffing, and reading
 * it back made every stamped default count as an explicit override, which
 * skipped tier resolution and re-stamped the record on every start
 * (PAN-3857).
 */

/** PAN-2410: --fresh means fresh STAFFING, not just a fresh session. Never
 * inherit the dead agent's recorded model — with no explicit --model the
 * tier/role resolvers run against current config. A plain restart (no
 * --fresh) keeps the recorded staffing, by design. */
export function resolveSpawnModel(
  explicitModel: string | undefined,
  fresh: boolean | undefined,
  recordedModel: string | undefined,
): string | undefined {
  return explicitModel || (fresh ? undefined : recordedModel);
}

/** The model `pan start` hands to the spawn: explicit --model, else the prior
 * agent's model for resume continuity (dropped by --fresh). */
export function resolveStartSpawnModel(
  explicitModel: string | undefined,
  fresh: boolean | undefined,
  priorAgentModel: string | undefined,
): string | undefined {
  return explicitModel ?? resolveSpawnModel(undefined, fresh, priorAgentModel);
}
