/**
 * workspace-env — parse a workspace's rendered `.env` and, when a project opts
 * in via `workspace.env.load: true`, surface it to agent launcher shells and
 * host quality gates (PAN-5062).
 *
 * `workspace.env.template` renders `<workspace>/.env` at workspace creation,
 * but nothing previously loaded it into the process env that dbt's
 * `env_var()` (or any other tool that reads `process.env`) sees. This module
 * is the one place that reads that file back.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { shellQuote } from './shell-quote.js';
import type { ProjectConfig } from './workspace-config.js';
import { findProjectByPath } from './projects.js';
import { canonicalPath } from './projects/path-containment.js';

const RESERVED_ENV_KEYS: ReadonlySet<string> = new Set(['PATH', 'HOME']);
const ENV_LINE_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/**
 * Parse `.env`-style content into a flat key/value map. Lines are trimmed; blank
 * lines, `#` comments, and an optional leading `export ` are skipped before
 * matching `KEY=value`. A value wrapped in one matching pair of quotes has them
 * stripped. OVERDECK_* keys, PATH, and HOME are dropped — a workspace .env must
 * never override the host identity a gate or launcher shell already has.
 */
export function parseWorkspaceEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice('export '.length) : line;
    const match = ENV_LINE_RE.exec(withoutExport);
    if (!match) continue;
    const [, key, rawValue] = match as unknown as [string, string, string];
    if (key.startsWith('OVERDECK_') || RESERVED_ENV_KEYS.has(key)) continue;
    const value = rawValue.length >= 2 && /^(['"]).*\1$/.test(rawValue)
      ? rawValue.slice(1, -1)
      : rawValue;
    result[key] = value;
  }
  return result;
}

/** Read and parse `<workspacePath>/.env`, or `{}` when it does not exist. */
export function readWorkspaceEnv(workspacePath: string): Record<string, string> {
  const envPath = join(workspacePath, '.env');
  if (!existsSync(envPath)) return {};
  return parseWorkspaceEnv(readFileSync(envPath, 'utf-8'));
}

/**
 * The workspace's parsed `.env`, or `{}` unless the project opted in with
 * `workspace.env.load: true` and workspacePath is an actual workspace (not the
 * project's own checkout, which never gets a rendered .env).
 */
export function loadWorkspaceEnvForProject(
  project: ProjectConfig | null | undefined,
  workspacePath: string,
): Record<string, string> {
  if (project?.workspace?.env?.load !== true) return {};
  if (canonicalPath(workspacePath) === canonicalPath(project.path)) return {};
  return readWorkspaceEnv(workspacePath);
}

/**
 * Find the directory owning the workspace `.env`, starting at `workingDir`
 * and walking up to (but excluding) the project checkout root. A conversation
 * can launch rooted in a polyrepo subdirectory (e.g. `<workspace>/frontend`),
 * where `.env` lives only at `<workspace>/.env`. Returns null when no `.env`
 * exists in that range, or when `workingDir` is the project checkout itself.
 */
function resolveWorkspaceEnvDir(workingDir: string, project: ProjectConfig | null): string | null {
  let dir = resolve(workingDir);
  if (existsSync(join(dir, '.env'))) return dir;
  if (!project) return null;
  const projectRoot = resolve(project.path);
  if (dir === projectRoot) return null; // never load the project checkout's own .env
  for (;;) {
    const parent = dirname(dir);
    if (parent === dir || parent === projectRoot) return null; // fs root, or about to reach the checkout
    dir = parent;
    if (existsSync(join(dir, '.env'))) return dir;
  }
}

/**
 * `export KEY=value` launcher-script lines for the opted-in workspace .env, in
 * shell-safe form.
 */
export function workspaceEnvLauncherLines(
  workingDir: string,
  findProject: (workspacePath: string) => ProjectConfig | null = findProjectByPath,
): string[] {
  // A malformed projects.yaml must not make launcher script generation fatal
  // over an opt-in convenience feature.
  let project: ProjectConfig | null;
  try {
    project = findProject(workingDir);
  } catch {
    return [];
  }
  const envDir = resolveWorkspaceEnvDir(workingDir, project);
  if (!envDir) return [];
  const env = loadWorkspaceEnvForProject(project, envDir);
  return Object.entries(env).map(([k, v]) => `export ${k}=${shellQuote(v)}`);
}
