/** Request-body parsing for POST /api/conversations (PAN-4486): project/cwd resolution and launch-context flags. */
import { realpath, stat } from 'node:fs/promises';
import { listProjectsAsync, type ProjectConfig } from '../projects.js';
import { isCoreSkill } from '../skill-overrides/resolve.js';
import type { ConversationLaunchContext } from './conversation-launch-context.js';
import { validateCwdContainment } from './cwd-containment.js';

/** A malformed create request; the route answers 400. */
export class ConversationCreateInputError extends Error {}

const MAX_SKILL_OVERRIDES = 200;
/** A skill name, or a pack skill id `pack/skill`. */
const SKILL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;

/** The per-conversation skill map; undefined when absent or empty. Core skills cannot be overridden. */
function parseSkillOverrides(raw: unknown): Record<string, boolean> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ConversationCreateInputError('Invalid skillOverrides');
  const entries = Object.entries(raw);
  if (entries.length > MAX_SKILL_OVERRIDES) throw new ConversationCreateInputError('Invalid skillOverrides');
  for (const [key, value] of entries) {
    if (!SKILL_ID_PATTERN.test(key) || typeof value !== 'boolean') throw new ConversationCreateInputError('Invalid skillOverrides');
    if (isCoreSkill(key)) throw new ConversationCreateInputError(`Core skill cannot be overridden: ${key}`);
  }
  return entries.length > 0 ? Object.fromEntries(entries) as Record<string, boolean> : undefined;
}

/** The PAN-4185 context opt-outs and the PAN-4486 skill map from a create request body. */
export function parseConversationLaunchContext(body: Record<string, unknown>): ConversationLaunchContext {
  const skillOverrides = parseSkillOverrides(body['skillOverrides']);
  return {
    bareContext: body['bareContext'] === true,
    skipClaudeMd: body['skipClaudeMd'] === true,
    ...(skillOverrides ? { skillOverrides } : {}),
  };
}

export interface ResolvedRegisteredProject {
  key: string;
  config: ProjectConfig;
}

/** Resolve a project key or display name without blocking the dashboard event loop. */
export async function resolveRegisteredProject(
  input: string,
): Promise<ResolvedRegisteredProject | { error: string }> {
  const projects = await listProjectsAsync();
  const project = projects.find((candidate) => candidate.key === input)
    ?? projects.find((candidate) => candidate.config.name === input);
  return project ?? { error: `Unknown project: ${input}` };
}

/**
 * Resolve a conversation's cwd from a project identifier.
 *
 * The Command Deck identifies projects by display name, not yaml key
 * (PAN-2590) — accept either, like GET /api/session-trees does.
 */
export async function resolveProjectCwd(
  projectIdentifier: string,
): Promise<{ key: string; cwd: string } | { error: string }> {
  const resolved = await resolveRegisteredProject(projectIdentifier);
  if ('error' in resolved) return resolved;
  const projectPath = resolved.config.path;
  if (!projectPath) {
    return { error: `Project path does not exist: (unset) (project: ${projectIdentifier})` };
  }
  try {
    await stat(projectPath);
  } catch {
    return { error: `Project path does not exist: ${projectPath} (project: ${projectIdentifier})` };
  }
  return { key: resolved.key, cwd: projectPath };
}

/**
 * The create request's cwd and canonical project key. A `cwd` needs a project
 * and must resolve inside it (the project root included, so a primary checkout
 * stays allowed); the returned cwd is its realpath.
 */
export async function resolveConversationCreateTarget(
  input: { projectKey?: string; cwd?: unknown },
  defaultCwd: string,
): Promise<{ cwd: string; projectKey?: string }> {
  const cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : undefined;
  if (!input.projectKey) {
    if (cwd) throw new ConversationCreateInputError('cwd requires projectKey');
    return { cwd: defaultCwd };
  }
  const resolved = await resolveProjectCwd(input.projectKey);
  if ('error' in resolved) throw new ConversationCreateInputError(resolved.error);
  if (!cwd) return { cwd: resolved.cwd, projectKey: resolved.key };
  const outside = new ConversationCreateInputError(`Invalid cwd: must be inside project ${resolved.key}`);
  if (!(await validateCwdContainment(cwd))) throw outside;
  const [realCwd, realProject] = await Promise.all([realpath(cwd), realpath(resolved.cwd)]);
  if (realCwd !== realProject && !realCwd.startsWith(`${realProject}/`)) throw outside;
  return { cwd: realCwd, projectKey: resolved.key };
}
