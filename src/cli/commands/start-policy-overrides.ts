import type { ReviewMode } from '../../lib/config-yaml.js';
import { getProjectSync, type ProjectConfig, type ResolvedProject } from '../../lib/projects.js';
import { normalizeModelOverrideSync } from '../../lib/model-validation.js';
import { updateIssueRecord } from '../../lib/pan-dir/record-update.js';
import type { SwarmMode } from '../../lib/swarm-policy.js';

export interface StartPolicyOptions {
  model?: string;
  swarm?: string;
  reviewMode?: string;
  reviewModel?: string;
}

export interface StartPolicyOverrides {
  workModel?: string;
  swarmMode?: SwarmMode;
  reviewMode?: ReviewMode;
  reviewModel?: string;
}

export function parseStartPolicyOverrides(options: StartPolicyOptions): StartPolicyOverrides {
  const overrides: StartPolicyOverrides = {};
  if (options.model !== undefined) overrides.workModel = normalizeModelOverrideSync(options.model);
  if (options.reviewModel !== undefined) overrides.reviewModel = normalizeModelOverrideSync(options.reviewModel);
  if (options.swarm !== undefined) {
    if (!['off', 'auto', 'always'].includes(options.swarm)) {
      throw new Error(`Invalid --swarm value: ${options.swarm}. Expected 'off', 'auto', or 'always'.`);
    }
    overrides.swarmMode = options.swarm as SwarmMode;
  }
  if (options.reviewMode !== undefined) {
    if (!['quick', 'full', 'none'].includes(options.reviewMode)) {
      throw new Error(`Invalid --review-mode value: ${options.reviewMode}. Expected 'quick', 'full', or 'none'.`);
    }
    overrides.reviewMode = options.reviewMode as ReviewMode;
  }
  return overrides;
}

export function hasStartPolicyOverrides(overrides: StartPolicyOverrides): boolean {
  return Object.values(overrides).some((value) => value !== undefined);
}

export async function persistStartPolicyOverrides(
  project: ProjectConfig,
  issueId: string,
  overrides: StartPolicyOverrides,
  signal?: AbortSignal,
): Promise<void> {
  if (!hasStartPolicyOverrides(overrides)) return;
  signal?.throwIfAborted();
  await updateIssueRecord(project, issueId, (record) => {
    if (overrides.workModel !== undefined) record.workModel = overrides.workModel;
    if (overrides.reviewMode !== undefined) record.reviewMode = overrides.reviewMode;
    if (overrides.reviewModel !== undefined) record.reviewModel = overrides.reviewModel;
    if (overrides.swarmMode !== undefined) {
      record.swarm = { ...record.swarm, policy: { ...record.swarm?.policy, mode: overrides.swarmMode } };
    }
  });
}

export async function applyStartPolicyOptions(
  resolved: ResolvedProject,
  issueId: string,
  options: StartPolicyOptions,
  dryRun: boolean,
  signal?: AbortSignal,
): Promise<void> {
  if (dryRun) return;
  const overrides = parseStartPolicyOverrides(options);
  if (!hasStartPolicyOverrides(overrides)) return;
  const project = getProjectSync(resolved.projectKey);
  if (!project) throw new Error(`Project configuration not found for ${resolved.projectName}`);
  await persistStartPolicyOverrides(project, issueId, overrides, signal);
}

/**
 * PAN-3848 (F4): the policy-override record write runs after the spawn
 * step, never before it — spawning must not take the record lock (F1: the
 * project-wide lock held across pushes starved a spawn). The override already
 * reached the running agent through state.json (spawn.ts writes
 * `model: selectedModel`), so a record-write failure here degrades to a
 * warning instead of failing the start.
 */
export async function applyStartPolicyOptionsAfterSpawn(
  resolved: ResolvedProject,
  issueId: string,
  options: StartPolicyOptions,
  dryRun: boolean,
  warn: (message: string) => void,
): Promise<void> {
  try {
    await applyStartPolicyOptions(resolved, issueId, options, dryRun);
  } catch (error) {
    warn(`Model override recorded in agent state only; record write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * PAN-3848 (F4): persist policy overrides BEFORE the kickoff-failure return.
 * The live session already carries the policy through state.json, so when
 * kickoff delivery fails the record must still catch up — returning early
 * with the previous policy persisted leaves the session and the record
 * disagreeing. Returns true when the caller should take the kickoff-failure
 * return path (work role whose kickoff was never confirmed delivered).
 */
export async function persistStartPoliciesThenCheckKickoff(
  resolved: ResolvedProject | null | undefined,
  agent: { role: string; kickoffDelivered?: boolean },
  issueId: string,
  options: StartPolicyOptions,
  dryRun: boolean,
  warn: (message: string) => void,
): Promise<boolean> {
  if (resolved) {
    await applyStartPolicyOptionsAfterSpawn(resolved, issueId, options, dryRun, warn);
  }
  return agent.role === 'work' && agent.kickoffDelivered === false;
}
