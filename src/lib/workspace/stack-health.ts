import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { emitActivityEntry } from '../activity-logger.js';
import {
  getCachedDockerContainerLifecycleObservedAt,
  getCachedDockerContainerLifecycleSnapshot,
  recordDockerContainerLifecycleSnapshot,
  type DockerContainerLifecycle,
} from '../docker-stats.js';
import { parseIssueId } from '../issue-id.js';
import { findProjectByTeam } from '../projects.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_STUCK_CREATED_THRESHOLD_MS = 120_000;

export type { DockerContainerLifecycle } from '../docker-stats.js';

export interface WorkspaceStackHealth {
  healthy: boolean;
  reasons: string[];
  lastObserved: string;
}

export interface WorkspaceStackProject {
  workspace?: { docker?: { compose_template?: string } };
}

export interface WorkspaceStackHealthOptions {
  projectConfig?: WorkspaceStackProject | null;
  containers?: DockerContainerLifecycle[];
  now?: Date;
  stuckCreatedThresholdMs?: number;
  emitTransitionActivity?: boolean;
}

interface DockerPsJson {
  ID?: string;
  Names?: string;
  Name?: string;
  Status?: string;
  State?: string;
  CreatedAt?: string;
}

const lastHealthByIssue = new Map<string, boolean>();

function normalizeIssue(issueId: string): string {
  return parseIssueId(issueId)?.normalized ?? issueId.toLowerCase();
}

function resolveStackProject(issueId: string): WorkspaceStackProject | null {
  const prefix = parseIssueId(issueId)?.prefix ?? issueId.split('-')[0];
  return prefix ? findProjectByTeam(prefix) ?? null : null;
}

function hasDockerWorkspace(projectConfig: WorkspaceStackProject | null | undefined): boolean {
  return Boolean(projectConfig?.workspace?.docker?.compose_template);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasNameToken(name: string, token: string): boolean {
  return new RegExp(`(^|[-_])${escapeRegExp(token)}($|[-_])`).test(name);
}

export function inferIssueIdFromStackContainerName(name: string): string | null {
  const lower = name.toLowerCase();
  const standard = lower.match(/(?:^|[-_])feature-([a-z]+-\d+)(?=$|[-_])/) ?? lower.match(/(?:^|[-_])([a-z]+-\d+)(?=$|[-_])/);
  if (standard?.[1]) return standard[1].toUpperCase();

  const rally = lower.match(/(?:^|[-_])feature-((?:f|us|de|ta|tc)\d+)(?=$|[-_])/) ?? lower.match(/(?:^|[-_])((?:f|us|de|ta|tc)\d+)(?=$|[-_])/);
  return rally?.[1]?.toUpperCase() ?? null;
}

function isStackContainer(container: DockerContainerLifecycle, issueId: string): boolean {
  const normalized = normalizeIssue(issueId);
  const name = container.name.toLowerCase();
  return hasNameToken(name, `feature-${normalized}`) || hasNameToken(name, normalized);
}

function isInitContainer(name: string): boolean {
  return /(^|[-_])init($|[-_])/.test(name.toLowerCase());
}

function parseExitCode(status: string): number | null {
  const match = status.match(/exited \((\d+)\)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function isCreated(container: DockerContainerLifecycle): boolean {
  return container.state?.toLowerCase() === 'created' || /^created\b/i.test(container.status);
}

function isExited(container: DockerContainerLifecycle): boolean {
  return container.state?.toLowerCase() === 'exited' || /^exited\b/i.test(container.status);
}

function createdAgeMs(container: DockerContainerLifecycle, now: Date): number | null {
  if (!container.createdAt) return null;
  const created = new Date(container.createdAt).getTime();
  if (Number.isNaN(created)) return null;
  return now.getTime() - created;
}

export function evaluateWorkspaceStackHealth(
  issueId: string,
  projectConfig: WorkspaceStackProject | null | undefined,
  containers: DockerContainerLifecycle[],
  options: { now?: Date; stuckCreatedThresholdMs?: number } = {},
): WorkspaceStackHealth {
  const now = options.now ?? new Date();
  const lastObserved = now.toISOString();
  if (!hasDockerWorkspace(projectConfig)) {
    return { healthy: true, reasons: [], lastObserved };
  }

  const thresholdMs = options.stuckCreatedThresholdMs ?? DEFAULT_STUCK_CREATED_THRESHOLD_MS;
  const stackContainers = containers.filter((container) => isStackContainer(container, issueId));
  const reasons: string[] = [];

  for (const container of stackContainers) {
    const exitCode = parseExitCode(container.status);
    if (isExited(container) && exitCode !== null && exitCode !== 0) {
      const role = isInitContainer(container.name) ? 'init' : 'service';
      reasons.push(`${container.name} ${role} exited non-zero (${exitCode})`);
      continue;
    }

    if (isCreated(container)) {
      const ageMs = createdAgeMs(container, now);
      if (ageMs === null || ageMs >= thresholdMs) {
        const age = ageMs === null ? 'unknown age' : `${Math.floor(ageMs / 1000)}s`;
        reasons.push(`${container.name} stuck Created for ${age}`);
      }
    }
  }

  return { healthy: reasons.length === 0, reasons, lastObserved };
}

export async function collectDockerContainerLifecycleSnapshot(): Promise<DockerContainerLifecycle[]> {
  try {
    const { stdout } = await execFileAsync('docker', ['ps', '-a', '--format', '{{json .}}'], {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    const containers: DockerContainerLifecycle[] = [];
    for (const line of stdout.trim().split('\n')) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line) as DockerPsJson;
        const name = raw.Names ?? raw.Name;
        if (!raw.ID || !name) continue;
        containers.push({
          id: raw.ID,
          name,
          status: raw.Status ?? '',
          state: raw.State,
          createdAt: raw.CreatedAt,
        });
      } catch {
        // Ignore malformed docker rows.
      }
    }
    return containers;
  } catch {
    return [];
  }
}

export async function getWorkspaceStackHealth(
  issueId: string,
  options: WorkspaceStackHealthOptions = {},
): Promise<WorkspaceStackHealth> {
  const projectConfig = options.projectConfig ?? resolveStackProject(issueId);
  let observedAt: string | null = null;
  let containers = options.containers;

  if (!containers) {
    observedAt = getCachedDockerContainerLifecycleObservedAt();
    containers = observedAt ? getCachedDockerContainerLifecycleSnapshot() : undefined;
  }

  if (!containers) {
    const observed = options.now ?? new Date();
    containers = await collectDockerContainerLifecycleSnapshot();
    observedAt = observed.toISOString();
    recordDockerContainerLifecycleSnapshot(containers, observedAt);
  }

  const health = evaluateWorkspaceStackHealth(issueId, projectConfig, containers, {
    now: options.now,
    stuckCreatedThresholdMs: options.stuckCreatedThresholdMs,
  });
  const observedHealth = observedAt && !options.now
    ? { ...health, lastObserved: observedAt }
    : health;

  if (options.emitTransitionActivity) {
    recordWorkspaceStackHealthTransition(issueId, observedHealth);
  }

  return observedHealth;
}

export function recordWorkspaceStackHealthTransition(issueId: string, health: WorkspaceStackHealth): boolean {
  const key = normalizeIssue(issueId);
  const previous = lastHealthByIssue.get(key);
  lastHealthByIssue.set(key, health.healthy);

  if (previous !== true || health.healthy) return false;

  emitActivityEntry({
    source: 'cloister',
    level: 'error',
    issueId: issueId.toUpperCase(),
    message: `workspace-stack-unhealthy: ${issueId.toUpperCase()}`,
    details: health.reasons.join('; '),
  });
  return true;
}

export function resetWorkspaceStackHealthTransitionsForTests(): void {
  lastHealthByIssue.clear();
}
