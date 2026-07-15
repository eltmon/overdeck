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

export async function persistStartPolicyOverrides(project: ProjectConfig, issueId: string, overrides: StartPolicyOverrides): Promise<void> {
  if (!hasStartPolicyOverrides(overrides)) return;
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
): Promise<void> {
  if (dryRun) return;
  const overrides = parseStartPolicyOverrides(options);
  if (!hasStartPolicyOverrides(overrides)) return;
  const project = getProjectSync(resolved.projectKey);
  if (!project) throw new Error(`Project configuration not found for ${resolved.projectName}`);
  await persistStartPolicyOverrides(project, issueId, overrides);
}
