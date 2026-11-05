/**
 * Launch project and project secrets (PAN-5061).
 *
 * A launch belongs to the project its issue prefix names, or else to the
 * project whose root contains its cwd (D-6). That project's
 * `workspace.env.secrets_file` (an absolute or `~/` dotenv file outside the
 * repository) supplies extra env for its agents and gates. Overdeck's own keys
 * (every `OVERDECK_*` key and the blanked provider keys) cannot be set from it.
 * Warnings name projects and keys only, never values.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { BLANKED_PROVIDER_ENV } from '../child-env.js';
import { parseEnvFile } from '../env-loader.js';
import { getProjectSync, listProjectsAsync, resolveProjectFromIssueSync, type ProjectConfig } from '../projects.js';
import { canonicalPathAsync, findContainingProjectAsync, isWithin } from './path-containment.js';

export interface LaunchProject { key: string; config: ProjectConfig }

/** D-6: issue prefix first, then cwd containment; null when neither matches. */
export async function resolveLaunchProject(input: { issueId?: string; cwd?: string }): Promise<LaunchProject | null> {
  if (input.issueId) {
    const resolved = resolveProjectFromIssueSync(input.issueId);
    const config = resolved ? getProjectSync(resolved.projectKey) : null;
    if (resolved && config) return { key: resolved.projectKey, config };
  }
  if (input.cwd) {
    const projects = Object.fromEntries((await listProjectsAsync()).map(({ key, config }) => [key, config]));
    const match = await findContainingProjectAsync(projects, input.cwd);
    if (match) return { key: match[0], config: match[1] };
  }
  return null;
}

function isReservedKey(key: string): boolean {
  return key.startsWith('OVERDECK_') || Object.prototype.hasOwnProperty.call(BLANKED_PROVIDER_ENV, key);
}

/** FR-9: the project's secrets file, reserved keys dropped; {} with one warning on any path or read problem. */
export async function readProjectSecrets(
  project: LaunchProject,
  warn: (line: string) => void = console.warn,
): Promise<Record<string, string>> {
  const raw = project.config.workspace?.env?.secrets_file;
  if (raw === undefined) return {};
  const prefix = `[project-env] ${project.key}:`;
  const path = raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw;
  if (!isAbsolute(path)) {
    warn(`${prefix} secrets_file must be an absolute or ~/ path`);
    return {};
  }
  if (project.config.path && isWithin(await canonicalPathAsync(project.config.path), await canonicalPathAsync(path))) {
    warn(`${prefix} secrets_file must live outside the project repository`);
    return {};
  }

  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
    warn(`${prefix} secrets_file not readable: ${code}`);
    return {};
  }

  const secrets: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(parseEnvFile(content))) {
    if (isReservedKey(key)) dropped.push(key);
    else secrets[key] = value;
  }
  if (dropped.length > 0) warn(`${prefix} secrets_file reserved keys dropped: ${dropped.join(', ')}`);
  return secrets;
}

/** Both steps; {} when there is no launch project or no secrets_file. */
export async function projectLaunchEnv(input: { issueId?: string; cwd?: string }): Promise<Record<string, string>> {
  const project = await resolveLaunchProject(input);
  return project ? readProjectSecrets(project) : {};
}
