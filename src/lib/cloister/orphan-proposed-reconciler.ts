import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { Effect } from 'effect';

import { getAgentState, type AgentState } from '../agents.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { listProjects, type ProjectConfig } from '../projects.js';
import { getShadowState } from '../shadow-state.js';
import { listSessionNames } from '../tmux.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';
import { loadCloisterConfigSync } from './config.js';

const execFileAsync = promisify(execFile);
const DEFAULT_ATTEMPT_INTERVAL_MS = 5 * 60 * 1000;
const TRACKER_CLOSED_CACHE_TTL_MS = 5 * 60 * 1000;
const attemptCooldowns = new Map<string, number>();
const trackerClosedCache = new Map<string, { closed: boolean; checkedAt: number }>();

export interface OrphanProposedReconcilerConfig {
  enabled?: boolean;
  minAttemptIntervalMs?: number;
}

type ProjectEntry = { key: string; config: Pick<ProjectConfig, 'name' | 'path'> };

type ProposedSpecState = {
  plan?: {
    id?: unknown;
    status?: unknown;
    items?: unknown;
  };
};

export interface OrphanProposedCandidate {
  projectKey: string;
  projectName: string;
  projectPath: string;
  issueId: string;
  specPath: string;
  beadCount: number;
  planItemCount: number;
}

export interface FindOrphanProposedOptions {
  projects?: ProjectEntry[];
  tmuxSessionNames?: readonly string[];
  getAgentStateForIssue?: (agentId: string) => Promise<Pick<AgentState, 'status' | 'paused' | 'troubled'> | null>;
  closedIssueIds?: Set<string>;
}

export interface SpawnWorkAgentResult {
  spawned: boolean;
  agentId?: string;
  skippedReason?: string;
  error?: string;
}

export interface ReconcileOrphanProposedOptions extends FindOrphanProposedOptions {
  now?: Date;
  config?: OrphanProposedReconcilerConfig;
  spawnWorkAgent?: (issueId: string) => Promise<SpawnWorkAgentResult>;
  dashboardOrigin?: string;
}

function normalizeIssueId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z]+-\d+$/.test(value.trim())
    ? value.trim().toUpperCase()
    : null;
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

async function countBeadsForIssue(projectPath: string, issueId: string): Promise<number> {
  const beadsPath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`, '.beads', 'issues.jsonl');
  if (!existsSync(beadsPath)) return 0;

  try {
    const raw = await readFile(beadsPath, 'utf-8');
    return raw.split('\n').filter(Boolean).filter((line) => {
      try {
        const record = JSON.parse(line) as { _type?: unknown; labels?: unknown };
        return record._type === 'issue'
          && Array.isArray(record.labels)
          && record.labels.some((label) => typeof label === 'string' && label.toLowerCase() === issueId.toLowerCase());
      } catch {
        return false;
      }
    }).length;
  } catch {
    return 0;
  }
}

async function defaultGetAgentState(agentId: string): Promise<Pick<AgentState, 'status' | 'paused' | 'troubled'> | null> {
  return Effect.runPromise(getAgentState(agentId).pipe(Effect.catch(() => Effect.succeed(null))));
}

async function isTrackerIssueClosed(issueId: string): Promise<boolean> {
  const cached = trackerClosedCache.get(issueId);
  const now = Date.now();
  if (cached && now - cached.checkedAt < TRACKER_CLOSED_CACHE_TTL_MS) return cached.closed;

  const resolved = resolveGitHubIssueSync(issueId);
  if (!resolved.isGitHub) {
    trackerClosedCache.set(issueId, { closed: false, checkedAt: now });
    return false;
  }

  try {
    const { stdout } = await execFileAsync('gh', [
      'issue',
      'view',
      String(resolved.number),
      '--repo',
      `${resolved.owner}/${resolved.repo}`,
      '--json',
      'state',
    ], { encoding: 'utf-8', timeout: 10_000 });
    const parsed = JSON.parse(stdout) as { state?: unknown };
    const closed = typeof parsed.state === 'string' && parsed.state.toLowerCase() === 'closed';
    trackerClosedCache.set(issueId, { closed, checkedAt: now });
    return closed;
  } catch {
    trackerClosedCache.set(issueId, { closed: false, checkedAt: now });
    return false;
  }
}

async function isIssueClosed(issueId: string, closedIssueIds?: Set<string>): Promise<boolean> {
  if (closedIssueIds) return closedIssueIds.has(issueId);

  const shadowState = await Effect.runPromise(getShadowState(issueId).pipe(Effect.catch(() => Effect.succeed(null))));
  return shadowState?.trackerStatus === 'closed'
    || shadowState?.shadowStatus === 'closed'
    || shadowState?.targetCanonicalState === 'done'
    || shadowState?.targetCanonicalState === 'canceled'
    || await isTrackerIssueClosed(issueId);
}

async function loadProjectsForScan(projects?: ProjectEntry[]): Promise<ProjectEntry[]> {
  if (projects) return projects;
  return Effect.runPromise(listProjects().pipe(Effect.catch(() => Effect.succeed([]))));
}

async function loadTmuxSessionNames(tmuxSessionNames?: readonly string[]): Promise<readonly string[]> {
  if (tmuxSessionNames) return tmuxSessionNames;
  return Effect.runPromise(listSessionNames().pipe(Effect.catch(() => Effect.succeed([]))));
}

export async function findOrphanProposedSpecsForReconciler(options: FindOrphanProposedOptions = {}): Promise<OrphanProposedCandidate[]> {
  const projects = await loadProjectsForScan(options.projects);
  const tmuxSessionNames = await loadTmuxSessionNames(options.tmuxSessionNames);
  const getState = options.getAgentStateForIssue ?? defaultGetAgentState;
  const candidates: OrphanProposedCandidate[] = [];

  for (const { key, config } of projects) {
    const specsDir = join(config.path, '.pan', 'specs');
    if (!existsSync(specsDir)) continue;

    const entries = await readdir(specsDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.vbrief.json')) continue;

      const specPath = join(specsDir, entry.name);
      const spec = await readJsonFile<ProposedSpecState>(specPath);
      if (spec?.plan?.status !== 'proposed') continue;

      const issueId = normalizeIssueId(spec.plan?.id);
      if (!issueId) continue;

      const agentId = `agent-${issueId.toLowerCase()}`;
      const state = await getState(agentId);
      if (tmuxSessionNames.includes(agentId)) continue;
      if (state?.status === 'starting' || state?.status === 'running') continue;
      if (state?.paused === true || state?.troubled === true) continue;
      if (await isIssueClosed(issueId, options.closedIssueIds)) continue;

      const planItems = Array.isArray(spec.plan.items) ? spec.plan.items : [];
      const planItemCount = planItems.length;
      const beadCount = await countBeadsForIssue(config.path, issueId);
      if (planItemCount === 0 || beadCount !== planItemCount) continue;

      candidates.push({
        projectKey: key,
        projectName: config.name,
        projectPath: config.path,
        issueId,
        specPath,
        beadCount,
        planItemCount,
      });
    }
  }

  return candidates;
}

function internalDashboardOrigin(): string {
  const port = Number.parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '3011', 10);
  return process.env['PANOPTICON_INTERNAL_DASHBOARD_URL'] ?? `http://127.0.0.1:${port}`;
}

function classifySpawnSkip(status: number, body: Record<string, unknown>): string {
  const error = typeof body['error'] === 'string' ? body['error'] : '';
  if (body['stackHealth'] || /workspace docker stack/i.test(error)) return 'stack-unhealthy';
  if (body['paused'] === true) return 'paused';
  if (body['troubled'] === true) return 'troubled';
  if (body['guardrails'] || body['requiresAcknowledgement'] === true || status === 409) return 'guardrails';
  if (body['providerHealth']) return 'provider-down';
  return 'spawn-failed';
}

export async function spawnWorkAgentThroughAgentsEndpoint(issueId: string, dashboardOrigin = internalDashboardOrigin()): Promise<SpawnWorkAgentResult> {
  const response = await fetch(new URL('/api/agents', dashboardOrigin), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: dashboardOrigin,
    },
    body: JSON.stringify({ issueId, role: 'work' }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : `agent-${issueId.toLowerCase()}`;

  if (response.ok && body['success'] !== false) {
    return { spawned: true, agentId };
  }

  return {
    spawned: false,
    skippedReason: classifySpawnSkip(response.status, body),
    error: typeof body['error'] === 'string'
      ? body['error']
      : typeof body['message'] === 'string'
        ? body['message']
        : `Work agent spawn returned HTTP ${response.status}`,
  };
}

function emitReconcilerEvent(level: 'info' | 'warn' | 'error' | 'success', message: string, details: Record<string, unknown>, issueId?: string): void {
  emitActivityEntrySync({
    source: 'cloister',
    level,
    issueId,
    message,
    details: JSON.stringify(details),
  });
}

export async function reconcileOrphanProposedSpecs(options: ReconcileOrphanProposedOptions = {}): Promise<string[]> {
  const loadedConfig = options.config ?? loadCloisterConfigSync().orphanProposedReconciler ?? { enabled: true };
  if (loadedConfig.enabled === false) return [];

  const now = options.now ?? new Date();
  const minAttemptIntervalMs = Math.max(loadedConfig.minAttemptIntervalMs ?? DEFAULT_ATTEMPT_INTERVAL_MS, DEFAULT_ATTEMPT_INTERVAL_MS);
  const actions: string[] = [];

  emitReconcilerEvent('info', 'orphan-proposed-reconciler.scan-start', { at: now.toISOString() });
  const candidates = await findOrphanProposedSpecsForReconciler(options);

  for (const candidate of candidates) {
    emitReconcilerEvent('warn', 'orphan-proposed-reconciler.orphan-detected', { ...candidate }, candidate.issueId);

    const lastAttempt = attemptCooldowns.get(candidate.issueId);
    if (lastAttempt !== undefined && now.getTime() - lastAttempt < minAttemptIntervalMs) {
      const remainingMs = minAttemptIntervalMs - (now.getTime() - lastAttempt);
      emitReconcilerEvent('info', 'orphan-proposed-reconciler.spawn-skipped', {
        ...candidate,
        reason: 'cooldown',
        remainingMs,
      }, candidate.issueId);
      continue;
    }

    attemptCooldowns.set(candidate.issueId, now.getTime());
    emitReconcilerEvent('info', 'orphan-proposed-reconciler.spawn-attempt', { ...candidate }, candidate.issueId);

    try {
      const spawn = await (options.spawnWorkAgent ?? ((issueId) => spawnWorkAgentThroughAgentsEndpoint(issueId, options.dashboardOrigin)))(candidate.issueId);
      if (spawn.spawned) {
        emitReconcilerEvent('success', 'orphan-proposed-reconciler.spawn-success', {
          ...candidate,
          agentId: spawn.agentId,
        }, candidate.issueId);
        actions.push(`Spawned work agent for orphan proposed spec ${candidate.issueId}`);
      } else {
        emitReconcilerEvent('warn', 'orphan-proposed-reconciler.spawn-skipped', {
          ...candidate,
          reason: spawn.skippedReason ?? 'spawn-failed',
          error: spawn.error,
        }, candidate.issueId);
        actions.push(`Skipped orphan proposed spec ${candidate.issueId}: ${spawn.skippedReason ?? 'spawn-failed'}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitReconcilerEvent('error', 'orphan-proposed-reconciler.spawn-skipped', {
        ...candidate,
        reason: 'spawn-failed',
        error: message,
      }, candidate.issueId);
      actions.push(`Skipped orphan proposed spec ${candidate.issueId}: spawn-failed`);
    }
  }

  return actions;
}

export function clearOrphanProposedAttemptCooldowns(): void {
  attemptCooldowns.clear();
  trackerClosedCache.clear();
}
