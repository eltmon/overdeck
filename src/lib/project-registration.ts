/**
 * Server-safe project registration core.
 *
 * No chalk, no console, no execSync. Import and use from API routes or CLI.
 */

import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';

import {
  getProjectSync,
  registerProject,
  type ProjectConfig,
} from './projects.js';
import { ensureProjectLayer } from './context-layers/index.js';
import { installGitHooksInDir } from './git-hooks.js';

export { installGitHooksInDir } from './git-hooks.js';

export class DuplicateProjectError extends Error {
  constructor(public readonly key: string, public readonly existingPath: string) {
    super(`Project already registered with key: ${key} (path: ${existingPath})`);
    this.name = 'DuplicateProjectError';
  }
}

export type RegisterProjectExtras = Pick<
  ProjectConfig,
  'issue_prefix' | 'github_repo' | 'gitlab_repo' | 'tracker' | 'workspace'
>;

export interface RegisterProjectOptions {
  path: string;
  name?: string;
  extras?: RegisterProjectExtras;
}

export interface RegisterProjectResult {
  key: string;
  config: ProjectConfig;
  seededContextLayer: boolean;
  hooksInstalled: number;
}

/**
 * Register a project from a filesystem path.
 *
 * Throws `DuplicateProjectError` if the derived key is already registered.
 * Returns key, config, and installation metadata on success.
 */
export async function registerProjectFromPath(
  opts: RegisterProjectOptions,
): Promise<RegisterProjectResult> {
  const { path: fullPath } = opts;
  const name = opts.name ?? (basename(fullPath) || 'unknown');
  const key = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // Guard: a key that is empty or contains only hyphens cannot be meaningfully addressed.
  if (!key.replace(/-/g, '')) {
    throw new Error(
      `Cannot register project: derived key '${key}' from name '${name}' contains no alphanumeric characters`,
    );
  }

  const existing = getProjectSync(key);
  if (existing) {
    throw new DuplicateProjectError(key, existing.path);
  }

  const projectConfig: ProjectConfig = { name, path: fullPath, ...(opts.extras ?? {}) };
  registerProject(key, projectConfig);

  const seededContextLayer = ensureProjectLayer(fullPath);

  // Pre-trust the project directory in Claude Code (non-fatal — H7).
  try {
    const { preTrustDirectory } = await import('./workspace-manager.js');
    await preTrustDirectory(fullPath);
  } catch { /* non-fatal */ }

  // Install git hooks where .git exists.
  let hooksInstalled = 0;
  const rootGit = join(fullPath, '.git');
  if (existsSync(rootGit)) {
    hooksInstalled = installGitHooksInDir(rootGit);
  }

  return { key, config: projectConfig, seededContextLayer, hooksInstalled };
}
