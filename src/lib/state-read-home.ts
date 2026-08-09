import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOverdeckHome } from './paths.js';
import { resolveInfraRepo, type ProjectConfig } from './projects.js';
import { projectKey as resolveProjectKey } from './project-key.js';

export interface StateReadHome {
  root: string;
  migrated: boolean;
}
export const STATE_BRANCH = 'overdeck-state';

function validMarker(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const marker = value as Record<string, unknown>;
  return typeof marker.sourceMainSha === 'string' && /^[0-9a-f]{40}$/i.test(marker.sourceMainSha)
    && typeof marker.stateBranchSha === 'string' && /^[0-9a-f]{40}$/i.test(marker.stateBranchSha)
    && typeof marker.completedAt === 'string' && Number.isFinite(Date.parse(marker.completedAt))
    && Number.isInteger(marker.version) && Number(marker.version) >= 1;
}

export function resolveStateReadHomeSync(project: ProjectConfig, projectKey?: string): StateReadHome {
  const root = join(getOverdeckHome(), 'state', resolveProjectKey(project, projectKey));
  try {
    if (validMarker(JSON.parse(readFileSync(join(root, 'migration-complete.json'), 'utf8')))) {
      return { root, migrated: true };
    }
  } catch {}
  try {
    return { root: resolveInfraRepo(project).repoPath, migrated: false };
  } catch {
    return { root: project.path, migrated: false };
  }
}

/**
 * Async twin of {@link resolveStateReadHomeSync} for request paths (e.g. the
 * dashboard's cross-project order-book scan) that must not block the Node
 * event loop with a synchronous read per candidate project.
 */
export async function resolveStateReadHomeAsync(project: ProjectConfig, projectKey?: string): Promise<StateReadHome> {
  const root = join(getOverdeckHome(), 'state', resolveProjectKey(project, projectKey));
  try {
    if (validMarker(JSON.parse(await readFile(join(root, 'migration-complete.json'), 'utf8')))) {
      return { root, migrated: true };
    }
  } catch {}
  try {
    return { root: resolveInfraRepo(project).repoPath, migrated: false };
  } catch {
    return { root: project.path, migrated: false };
  }
}

export function resolveStateDomainPathSync(project: ProjectConfig, domain: string, projectKey?: string): string {
  const home = resolveStateReadHomeSync(project, projectKey);
  return home.migrated ? join(home.root, domain) : join(home.root, '.pan', domain);
}

export function shouldCommitLegacyWorkspaceArtifacts(migrated: boolean): boolean {
  return !migrated;
}

export function hasMaterializedStateMarker(project: ProjectConfig, projectKey?: string): boolean {
  return existsSync(join(resolveStateReadHomeSync(project, projectKey).root, 'migration-complete.json'));
}
