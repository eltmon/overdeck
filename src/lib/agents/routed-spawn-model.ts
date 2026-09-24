/**
 * PAN-4145: the model a fresh spawn is staffed with when nobody chose one.
 */
import type { Role } from './agent-state.js';
import { determineModel } from './provider-env.js';
import { resolveSingleWorkTierSpawnParams } from './spawn-prep.js';

/**
 * The model a fresh spawn of `role` for `issueId` is staffed with when no
 * model is chosen: the single-work tier resolver (work role with a workspace
 * plan), else `roles.<role>` routing — the same pair spawnAgent runs. Callers
 * that need a model before `pan start` resolves it (policy checks, relaunches
 * of an agent with no recorded model) use this instead of a literal. Throws a
 * "no default model configured" error when routing cannot resolve (PAN-4145).
 */
export function resolveRoutedSpawnModel(input: { role: Role; issueId: string; workspace?: string }): string {
  const spawnKey = `${input.role}:${input.issueId}`;
  try {
    const tierParams = input.role === 'work' && input.workspace
      ? resolveSingleWorkTierSpawnParams(input.workspace, undefined, spawnKey)
      : {};
    return determineModel({ model: tierParams.model, role: input.role, spawnKey });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No default model configured for role "${input.role}" (${input.issueId}): ${reason}. ` +
      `Set roles.${input.role}.model in config.yaml or pass an explicit model.`,
    );
  }
}
