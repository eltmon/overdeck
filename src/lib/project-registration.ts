/**
 * Server-safe project registration core.
 *
 * No chalk, no console, no execSync. Import and use from API routes or CLI.
 */

import { existsSync, mkdirSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { join, basename } from 'node:path';

import {
  getProjectSync,
  registerProjectSync,
  type ProjectConfig,
} from './projects.js';
import { SYNC_SOURCES } from './paths.js';
import { ensureProjectLayer } from './context-layers/index.js';

// Bundled git hooks distributed to registered projects (PAN-1201).
const BUNDLED_HOOKS_DIR = SYNC_SOURCES.gitHooks;

export class DuplicateProjectError extends Error {
  constructor(public readonly key: string, public readonly existingPath: string) {
    super(`Project already registered with key: ${key} (path: ${existingPath})`);
    this.name = 'DuplicateProjectError';
  }
}

export interface RegisterProjectOptions {
  path: string;
  name?: string;
}

export interface RegisterProjectResult {
  key: string;
  config: ProjectConfig;
  seededContextLayer: boolean;
  hooksInstalled: number;
}

export function installGitHooksInDir(gitDir: string): number {
  const hooksTarget = join(gitDir, 'hooks');
  let installed = 0;

  if (!existsSync(hooksTarget)) {
    mkdirSync(hooksTarget, { recursive: true });
  }

  if (!existsSync(BUNDLED_HOOKS_DIR)) return 0;

  try {
    const hooks = readdirSync(BUNDLED_HOOKS_DIR).filter((f) => {
      const p = join(BUNDLED_HOOKS_DIR, f);
      return existsSync(p) && statSync(p).isFile();
    });

    for (const hook of hooks) {
      const source = join(BUNDLED_HOOKS_DIR, hook);
      const target = join(hooksTarget, hook);

      if (existsSync(target)) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { readlinkSync } = require('fs') as typeof import('fs');
          if (readlinkSync(target) === source) continue;
        } catch {
          // not a symlink — fall through to backup
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { renameSync } = require('fs') as typeof import('fs');
        renameSync(target, `${target}.backup`);
      }

      symlinkSync(source, target);
      installed++;
    }
  } catch {
    // hooks are optional — non-fatal
  }

  return installed;
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

  const projectConfig: ProjectConfig = { name, path: fullPath };
  registerProjectSync(key, projectConfig);

  const seededContextLayer = ensureProjectLayer(fullPath);

  // Pre-trust the project directory in Claude Code (non-fatal — H7).
  try {
    const { preTrustDirectorySync } = await import('./workspace-manager.js');
    preTrustDirectorySync(fullPath);
  } catch { /* non-fatal */ }

  // Install git hooks where .git exists.
  let hooksInstalled = 0;
  const rootGit = join(fullPath, '.git');
  if (existsSync(rootGit)) {
    hooksInstalled = installGitHooksInDir(rootGit);
  }

  return { key, config: projectConfig, seededContextLayer, hooksInstalled };
}
