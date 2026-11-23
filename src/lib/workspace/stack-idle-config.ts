/**
 * PAN-5250: per-project idle-stop configuration and the per-workspace pin.
 *
 * `workspace.docker.idle_stop` in a project's projects.yaml entry chooses how
 * long a workspace's frontend/dev containers may sit unused before Overdeck
 * stops them, and which compose services that applies to (FR-1). The pin file
 * `<workspace>/.overdeck/stack-pin.json` is operator intent that holds both
 * the idle stop and the memory reclaim off a workspace (D10).
 *
 * Imports stay narrow (NFR-7): projects.ts, Node built-ins, stack-reclaim-docker
 * and stack-health. stack-health must never import this module.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectSync, resolveProjectFromIssueSync, type ProjectConfig } from '../projects.js';
import { defaultWorkspacePath } from './stack-health.js';
import { CONTAINER_NAME_RE, RECLAIMABLE_STACK_SERVICES } from './stack-reclaim-docker.js';

export const DEFAULT_IDLE_STOP_MINUTES = 20;
export const DEFAULT_IDLE_STOP_SERVICES: readonly string[] = ['frontend', 'fe', 'dev'];
export const IDLE_STOP_DISABLE_ENV = 'OVERDECK_DISABLE_STACK_IDLE_STOP';

export interface IdleStopConfig {
  enabled: boolean;
  minutes: number;
  services: ReadonlySet<string>;
}

/** Pure: FR-1 rules over a project entry (null → defaults) and an env map. */
export function resolveIdleStopConfig(
  project: ProjectConfig | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): IdleStopConfig {
  const raw = project?.workspace?.docker?.idle_stop;
  const rawMinutes: unknown = raw?.minutes;
  const minutes = typeof rawMinutes === 'number' && Number.isFinite(rawMinutes) && rawMinutes >= 0
    ? rawMinutes
    : DEFAULT_IDLE_STOP_MINUTES;
  const rawServices: unknown = raw?.services;
  const services = new Set(
    (Array.isArray(rawServices) ? rawServices : DEFAULT_IDLE_STOP_SERVICES)
      .filter((name): name is string => typeof name === 'string' && CONTAINER_NAME_RE.test(name)),
  );
  const enabled = env[IDLE_STOP_DISABLE_ENV] !== '1' && minutes !== 0 && services.size > 0;
  return { enabled, minutes, services };
}

function projectForIssue(issueId: string): ProjectConfig | null {
  try {
    const resolved = resolveProjectFromIssueSync(issueId);
    return resolved ? getProjectSync(resolved.projectKey) : null;
  } catch {
    return null;
  }
}

/** The issue's project → resolveIdleStopConfig. Never throws; a lookup failure returns the defaults. */
export function idleStopConfigForIssue(issueId: string): IdleStopConfig {
  return resolveIdleStopConfig(projectForIssue(issueId));
}

/** RECLAIMABLE_STACK_SERVICES ∪ DEFAULT_IDLE_STOP_SERVICES ∪ the issue's configured idle-stop services; used only by wake (D11). */
export function wakeableServicesForIssue(issueId: string): ReadonlySet<string> {
  return new Set([
    ...RECLAIMABLE_STACK_SERVICES,
    ...DEFAULT_IDLE_STOP_SERVICES,
    ...idleStopConfigForIssue(issueId).services,
  ]);
}

/** The issue's workspace path from its project's config; null when unresolvable. Never throws. */
export function workspacePathForIssue(issueId: string): string | null {
  try {
    return defaultWorkspacePath(issueId, projectForIssue(issueId));
  } catch {
    return null;
  }
}

export const STACK_PIN_FILE = 'stack-pin.json';

export function stackPinPath(workspacePath: string): string {
  return join(workspacePath, '.overdeck', STACK_PIN_FILE);
}

/** True when the pin file exists, even when it cannot be parsed (deny by default). */
export function isStackPinned(workspacePath: string): boolean {
  return existsSync(stackPinPath(workspacePath));
}

export function readStackPin(workspacePath: string): { pinnedAt: string } | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(stackPinPath(workspacePath), 'utf8'));
    if (parsed && typeof parsed === 'object' && typeof (parsed as { pinnedAt?: unknown }).pinnedAt === 'string') {
      return { pinnedAt: (parsed as { pinnedAt: string }).pinnedAt };
    }
    return null;
  } catch {
    return null;
  }
}

/** Creates `<ws>/.overdeck/` if needed (never the workspace itself) and writes `{ pinnedAt }`. */
export function writeStackPin(workspacePath: string, now: Date): void {
  if (!existsSync(workspacePath)) throw new Error(`workspace not found: ${workspacePath}`);
  mkdirSync(join(workspacePath, '.overdeck'), { recursive: true });
  writeFileSync(stackPinPath(workspacePath), `${JSON.stringify({ pinnedAt: now.toISOString() })}\n`);
}

/** Removes the pin file; true when a pin existed. */
export function removeStackPin(workspacePath: string): boolean {
  if (!isStackPinned(workspacePath)) return false;
  rmSync(stackPinPath(workspacePath), { force: true });
  return true;
}
