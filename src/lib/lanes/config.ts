/**
 * Per-project lane configuration with its defaults (.pan/drafts/pan-4223.md
 * WI-3 step 2, WI-4). The `projects.<key>.gauntlet` block is optional; this is
 * where it is validated and where the glossary defaults are applied.
 */
import { basename, dirname, join } from 'node:path';

import type { LaneRole } from '../overdeck/conversations.js';
import { listProjectsAsync, validateGauntletConfig, type GAUNTLET_ROLE_KEYS, type GauntletRoleConfig, type ProjectConfig } from '../projects.js';
import { LaneLaunchError } from './types.js';

/** Compile-time check: the configurable role keys are exactly the lane roles. */
type SameMembers<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const GAUNTLET_ROLES_MATCH_LANE_ROLES: SameMembers<(typeof GAUNTLET_ROLE_KEYS)[number], LaneRole> = true;

export interface LaneConfig {
  projectKey: string;
  projectPath: string;
  lanesRoot: string;
  baseRef: string;
  sparseCheckout: string[] | null;
  roles: Partial<Record<LaneRole, GauntletRoleConfig>>;
}

/** Applies the gauntlet defaults to one project's config. Throws LaneLaunchError(400) on an invalid block. */
export function laneConfigFor(projectKey: string, project: ProjectConfig): LaneConfig {
  const validation = validateGauntletConfig(project.gauntlet ?? {});
  if (!validation.ok) throw new LaneLaunchError(400, `projects.${projectKey}: ${validation.errors.join('; ')}`);
  const gauntlet = validation.config;
  return {
    projectKey,
    projectPath: project.path,
    lanesRoot: gauntlet.lanes_root ?? join(dirname(project.path), `${basename(project.path)}-lanes`),
    baseRef: gauntlet.base_ref ?? `origin/${project.workspace?.default_branch ?? 'main'}`,
    sparseCheckout: gauntlet.sparse_checkout && gauntlet.sparse_checkout.length > 0 ? gauntlet.sparse_checkout : null,
    roles: gauntlet.roles ?? {},
  };
}

/** Resolves a project key (or display name) to its lane config. */
export async function resolveLaneConfig(project: string): Promise<LaneConfig> {
  const projects = await listProjectsAsync();
  const match = projects.find((candidate) => candidate.key === project)
    ?? projects.find((candidate) => candidate.config.name === project);
  if (!match) throw new LaneLaunchError(400, `Unknown project: ${project}`);
  if (!match.config.path) throw new LaneLaunchError(400, `Project ${match.key} has no path`);
  return laneConfigFor(match.key, match.config);
}
