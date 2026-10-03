/** Request-body parsing for POST /api/conversations (PAN-4486): project/cwd resolution and launch-context flags. */
import { stat } from 'node:fs/promises';
import { listProjectsAsync, type ProjectConfig } from '../projects.js';
import type { ConversationLaunchContext } from './conversation-launch-context.js';

/** A malformed create request; the route answers 400. */
export class ConversationCreateInputError extends Error {}

/** The PAN-4185 context opt-outs from a create request body. */
export function parseConversationLaunchContext(body: Record<string, unknown>): ConversationLaunchContext {
  return { bareContext: body['bareContext'] === true, skipClaudeMd: body['skipClaudeMd'] === true };
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
