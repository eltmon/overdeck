/**
 * Spawn-model resolution for `pan start` (PAN-2410, PAN-3857).
 *
 * Only two inputs may choose the spawn model: an explicit `--model` flag and,
 * for a plain (non-`--fresh`) restart, the prior agent's model as resume
 * continuity. A pending `pan reset-session` drops that continuity like
 * `--fresh` does: the operator discarded the session, so there is nothing to
 * stay continuous with and a retuned tier must apply (PAN-3855). A stored `record.workModel` is NOT read back here — staffing
 * honors it through the issue-override tier in resolveStaffing, and reading
 * it back made every stamped default count as an explicit override, which
 * skipped tier resolution and re-stamped the record on every start
 * (PAN-3857).
 */
import chalk from 'chalk';
import { isSessionResetMarker } from '../../lib/session-history.js';

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
 * agent's model for resume continuity (dropped by --fresh and by a pending
 * session reset, PAN-3855). */
export function resolveStartSpawnModel(
  explicitModel: string | undefined,
  fresh: boolean | undefined,
  priorAgentModel: string | undefined,
  sessionReset = false,
): string | undefined {
  return explicitModel ?? resolveSpawnModel(undefined, fresh || sessionReset, priorAgentModel);
}

/** `pan start`'s spawn model for `agentId`. A pending `pan reset-session`
 * (the session-reset marker, cleared when the next launch marks the agent
 * running) drops the recorded model so current tier/role routing applies, and
 * says so instead of silently changing staffing (PAN-3855). */
export function resolvePanStartSpawnModel(
  agentId: string,
  explicitModel: string | undefined,
  fresh: boolean | undefined,
  priorAgentModel: string | undefined,
): string | undefined {
  const sessionReset = isSessionResetMarker(agentId);
  if (sessionReset && !explicitModel && !fresh && priorAgentModel) {
    console.log(chalk.dim(`Session was reset: not reusing recorded model ${priorAgentModel}; tier/role routing applies (pass --model to pin).`));
  }
  return resolveStartSpawnModel(explicitModel, fresh, priorAgentModel, sessionReset);
}
