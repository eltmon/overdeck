/**
 * Beads configuration standardization (PAN-2564 FR-8 / WI-8).
 *
 * `pan beads doctor` uses this module to:
 *  - remove unsupported legacy `no-db` keys from `.beads/config.yaml`
 *  - validate that `sync.remote` points at the project's git remote
 *  - ensure Dolt runtime files are gitignored in both the project root and `.beads/.gitignore`
 */

import { exec } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { parse as parseYaml } from 'yaml';

const execAsync = promisify(exec);

const RUNTIME_GITIGNORE_PATTERNS = [
  'dolt/',
  'embeddeddolt/',
  'dolt-server.*',
  '*.dolt',
  '.beads/backup/',
];

const BEADS_DIR_GITIGNORE_PATTERNS = [
  'dolt/',
  'embeddeddolt/',
  'dolt-server.*',
  '*.dolt',
  'backup/',
  '.beads/backup/',
];

const MANAGED_HEADER = '# Overdeck-managed beads Dolt runtime ignores (PAN-2564)';

export interface ConfigStandardizeOptions {
  /** Project checkout used to read `git remote get-url origin`. */
  projectPath: string;
  /** Canonical `.beads` directory (may be a redirected shared home). */
  beadsDir: string;
  /** When true, report needed fixes but do not write files. */
  dryRun: boolean;
}

export interface ConfigStandardizeResult {
  ok: boolean;
  messages: string[];
  fixes: string[];
  errors: string[];
}

/**
 * Normalize a git remote URL for comparison.
 *
 * Treats these as equivalent:
 *   git+ssh://git@github.com/eltmon/overdeck.git
 *   git@github.com:eltmon/overdeck.git
 *   https://github.com/eltmon/overdeck.git
 */
export function normalizeGitRemote(url: string): string {
  let normalized = url.trim().replace(/\.git$/i, '').replace(/\/+$/, '');

  if (normalized.startsWith('git@')) {
    const atIdx = normalized.indexOf('@');
    const colonIdx = normalized.indexOf(':');
    if (colonIdx > atIdx) {
      const host = normalized.slice(atIdx + 1, colonIdx);
      const path = normalized.slice(colonIdx + 1);
      return `${host.toLowerCase()}/${path.toLowerCase()}`;
    }
  }

  try {
    const parsed = new URL(normalized);
    const path = parsed.pathname.replace(/^\/+/, '').toLowerCase();
    return `${parsed.hostname.toLowerCase()}/${path}`;
  } catch {
    // Fall through for non-URL remotes (local paths, etc.)
  }

  return normalized.toLowerCase();
}

async function readProjectRemote(projectPath: string): Promise<string> {
  const { stdout } = await execAsync('git remote get-url origin', {
    cwd: projectPath,
    encoding: 'utf8',
  });
  return stdout.trim();
}

interface ConfigYamlShape {
  'no-db'?: boolean | string | number | null;
  sync?: { remote?: string } | null;
  [key: string]: unknown;
}

function readConfigYaml(beadsDir: string): ConfigYamlShape | null {
  const path = join(beadsDir, 'config.yaml');
  if (!existsSync(path)) return null;
  try {
    return parseYaml(readFileSync(path, 'utf8')) as ConfigYamlShape;
  } catch {
    return null;
  }
}

/**
 * Remove a top-level `no-db` key from `.beads/config.yaml` while preserving comments.
 * Returns true if a change was made (or would be made in dry-run mode).
 */
export function removeNoDbKey(beadsDir: string, dryRun: boolean): { changed: boolean; message?: string } {
  const path = join(beadsDir, 'config.yaml');
  if (!existsSync(path)) return { changed: false };

  const original = readFileSync(path, 'utf8');
  const lines = original.split(/\r?\n/);
  const filtered = lines.filter((line) => !/^no-db\s*:/.test(line));
  if (filtered.length === lines.length) return { changed: false };

  const removedCount = lines.length - filtered.length;
  if (!dryRun) {
    writeFileSync(path, filtered.join('\n'), { encoding: 'utf8' });
  }
  return {
    changed: true,
    message: `Removed ${removedCount} unsupported \`no-db\` key line(s) from ${path}${dryRun ? ' (dry-run)' : ''}`,
  };
}

function hasGitignorePattern(content: string, pattern: string): boolean {
  const lines = content.split(/\r?\n/);
  return lines.some((line) => line.trim() === pattern);
}

interface GitignoreFix {
  filePath: string;
  added: string[];
}

/**
 * Ensure a gitignore file contains the given patterns. Missing patterns are appended
 * under a managed header so they are easy to identify and update.
 */
export async function ensureGitignorePatterns(
  filePath: string,
  patterns: string[],
  dryRun: boolean,
): Promise<GitignoreFix> {
  await mkdir(dirname(filePath), { recursive: true });
  const original = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  const missing = patterns.filter((p) => !hasGitignorePattern(original, p));

  if (missing.length === 0) {
    return { filePath, added: [] };
  }

  if (!dryRun) {
    let output = original;
    if (!output.endsWith('\n') && output.length > 0) {
      output += '\n';
    }
    output += `${MANAGED_HEADER}\n`;
    for (const pattern of missing) {
      output += `${pattern}\n`;
    }
    writeFileSync(filePath, output, { encoding: 'utf8' });
  }

  return { filePath, added: missing };
}

/**
 * Standardize beads configuration for a project.
 *
 * Performs the checks/fixes required by `pan beads doctor`:
 *  1. Remove `no-db` keys from `.beads/config.yaml`.
 *  2. Validate `sync.remote` against the project's git remote.
 *  3. Ensure Dolt runtime files are gitignored.
 */
export async function standardizeBeadsConfig(
  options: ConfigStandardizeOptions,
): Promise<ConfigStandardizeResult> {
  const { projectPath, beadsDir, dryRun } = options;
  const messages: string[] = [];
  const fixes: string[] = [];
  const errors: string[] = [];

  // 1. Remove no-db keys.
  const noDbResult = removeNoDbKey(beadsDir, dryRun);
  if (noDbResult.changed) {
    fixes.push(noDbResult.message!);
    messages.push(noDbResult.message!);
  }

  // 2. Validate sync.remote.
  const config = readConfigYaml(beadsDir);
  if (!config) {
    errors.push(
      `No .beads/config.yaml found at ${beadsDir}. Run \`bd init\` or \`bd bootstrap\` to create a beads configuration.`,
    );
  } else {
    const syncRemote = config.sync?.remote;
    if (typeof syncRemote !== 'string' || syncRemote.length === 0) {
      errors.push(
        `\`sync.remote\` is missing in ${join(beadsDir, 'config.yaml')}. ` +
          `Set it to the project git remote so Dolt history can publish to refs/dolt/data.`,
      );
    } else {
      try {
        const projectRemote = await readProjectRemote(projectPath);
        if (normalizeGitRemote(syncRemote) !== normalizeGitRemote(projectRemote)) {
          errors.push(
            `\`sync.remote\` in ${join(beadsDir, 'config.yaml')} does not point at the project git remote. ` +
              `Expected ${projectRemote} (origin), but found ${syncRemote}. ` +
              `Run \`bd config set sync.remote ${projectRemote}\` or edit the file.`,
          );
        } else {
          messages.push(`\`sync.remote\` correctly points at ${projectRemote}.`);
        }
      } catch (error) {
        errors.push(
          `Could not read project git remote from ${projectPath}: ${error instanceof Error ? error.message : String(error)}. ` +
            `Ensure this directory has an \`origin\` remote.`,
        );
      }
    }
  }

  // 3. Ensure gitignore coverage.
  const projectGitignore = join(projectPath, '.gitignore');
  const beadsGitignore = join(beadsDir, '.gitignore');

  const projectFix = await ensureGitignorePatterns(projectGitignore, RUNTIME_GITIGNORE_PATTERNS, dryRun);
  if (projectFix.added.length > 0) {
    const text = `Added Dolt runtime ignore patterns to ${projectGitignore}: ${projectFix.added.join(', ')}${dryRun ? ' (dry-run)' : ''}`;
    fixes.push(text);
    messages.push(text);
  } else {
    messages.push(`Project .gitignore already covers Dolt runtime files.`);
  }

  const beadsFix = await ensureGitignorePatterns(beadsGitignore, BEADS_DIR_GITIGNORE_PATTERNS, dryRun);
  if (beadsFix.added.length > 0) {
    const text = `Added Dolt runtime ignore patterns to ${beadsGitignore}: ${beadsFix.added.join(', ')}${dryRun ? ' (dry-run)' : ''}`;
    fixes.push(text);
    messages.push(text);
  } else {
    messages.push(`.beads/.gitignore already covers Dolt runtime files.`);
  }

  return {
    ok: errors.length === 0,
    messages,
    fixes,
    errors,
  };
}
