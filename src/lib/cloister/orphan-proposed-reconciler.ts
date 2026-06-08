import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { isAbsolute, join, resolve } from 'path';
import { Effect } from 'effect';

import { getAgentState, type AgentState } from '../agents.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { listProjects, type ProjectConfig } from '../projects.js';
import { listSessionNames } from '../tmux.js';
import { loadCloisterConfig } from './config.js';
import { clearIssueClosedCache, isIssueClosed } from './issue-closed.js';

const DEFAULT_ATTEMPT_INTERVAL_MS = 5 * 60 * 1000;
const attemptCooldowns = new Map<string, number>();
let scanInFlight = false;

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

async function resolveBeadsIssuesPath(projectPath: string, issueId: string): Promise<string | null> {
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  const beadsDir = join(workspacePath, '.beads');
  const localIssuesPath = join(beadsDir, 'issues.jsonl');
  if (existsSync(localIssuesPath)) return localIssuesPath;

  const redirectPath = join(beadsDir, 'redirect');
  if (!existsSync(redirectPath)) return null;

  try {
    const redirected = (await readFile(redirectPath, 'utf-8')).trim();
    if (!redirected) return null;
    return join(isAbsolute(redirected) ? redirected : resolve(workspacePath, redirected), 'issues.jsonl');
  } catch {
    return null;
  }
}

async function countBeadsForIssue(projectPath: string, issueId: string): Promise<number> {
  const beadsPath = await resolveBeadsIssuesPath(projectPath, issueId);
  if (!beadsPath || !existsSync(beadsPath)) return 0;

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

/**
 * Surface a real, actioned reconciler outcome in the dashboard activity feed.
 * Use this ONLY when something actually happened that a human should see — a
 * work agent was started, or a start genuinely failed. `message` must read as a
 * plain sentence (it is what the feed shows), not a machine event name.
 */
function emitReconcilerActivity(
  level: 'info' | 'warn' | 'error' | 'success',
  message: string,
  details: Record<string, unknown> = {},
  issueId = 'ALL',
): void {
  const eventIssueId = issueId.toUpperCase();
  emitActivityEntrySync({
    source: 'cloister',
    level,
    issueId: eventIssueId,
    message,
    details: JSON.stringify({
      ...details,
      issueId: eventIssueId,
      timestamp: new Date().toISOString(),
    }),
  });
}

/**
 * Per-cycle diagnostic trail — console only, never the user activity feed.
 * The reconciler scans on every patrol (~60s); scan-start / orphan-detected /
 * cooldown-skip chatter was flooding the feed and reading as cryptic machine
 * codes (PAN-1626). Those belong in logs, not in front of the operator.
 */
function logReconcilerDiagnostic(kind: string, info: Record<string, unknown> = {}): void {
  console.debug(`[orphan-proposed-reconciler] ${kind}`, info);
}

export async function reconcileOrphanProposedSpecs(options: ReconcileOrphanProposedOptions = {}): Promise<string[]> {
  const loadedConfig = options.config ?? await Effect.runPromise(
    loadCloisterConfig().pipe(
      Effect.map(config => config.orphanProposedReconciler ?? { enabled: true, minAttemptIntervalMs: DEFAULT_ATTEMPT_INTERVAL_MS }),
      Effect.catch(() => Effect.succeed({ enabled: true, minAttemptIntervalMs: DEFAULT_ATTEMPT_INTERVAL_MS })),
    ),
  );
  if (loadedConfig.enabled === false) return [];
  if (scanInFlight) {
    logReconcilerDiagnostic('scan-skipped', { reason: 'previous scan still running' });
    return [];
  }

  scanInFlight = true;
  try {
    const now = options.now ?? new Date();
    const minAttemptIntervalMs = Math.max(loadedConfig.minAttemptIntervalMs ?? DEFAULT_ATTEMPT_INTERVAL_MS, DEFAULT_ATTEMPT_INTERVAL_MS);
    const actions: string[] = [];

    logReconcilerDiagnostic('scan-start', { scanAt: now.toISOString() });
    const candidates = await findOrphanProposedSpecsForReconciler(options);

    for (const candidate of candidates) {
    // Per-cycle detection is diagnostic, not feed-worthy — the actionable
    // outcome (spawn / failure) below is what the operator needs to see.
    logReconcilerDiagnostic('orphan-detected', { ...candidate });

    const lastAttempt = attemptCooldowns.get(candidate.issueId);
    if (lastAttempt !== undefined && now.getTime() - lastAttempt < minAttemptIntervalMs) {
      const remainingMs = minAttemptIntervalMs - (now.getTime() - lastAttempt);
      logReconcilerDiagnostic('spawn-skipped', { ...candidate, reason: 'cooldown', remainingMs });
      continue;
    }

    attemptCooldowns.set(candidate.issueId, now.getTime());
    logReconcilerDiagnostic('spawn-attempt', { ...candidate });

    try {
      const spawn = await (options.spawnWorkAgent ?? ((issueId) => spawnWorkAgentThroughAgentsEndpoint(issueId, options.dashboardOrigin)))(candidate.issueId);
      if (spawn.spawned) {
        emitReconcilerActivity(
          'success',
          `Started work agent for ${candidate.issueId} — proposed spec had tasks but no running agent`,
          { ...candidate, agentId: spawn.agentId },
          candidate.issueId,
        );
        actions.push(`Spawned work agent for orphan proposed spec ${candidate.issueId}`);
      } else {
        const reason = spawn.skippedReason ?? 'spawn-failed';
        emitReconcilerActivity(
          'warn',
          `Couldn't start work agent for ${candidate.issueId}: ${reason}`,
          { ...candidate, error: spawn.error },
          candidate.issueId,
        );
        actions.push(`Skipped orphan proposed spec ${candidate.issueId}: ${reason}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitReconcilerActivity(
        'error',
        `Couldn't start work agent for ${candidate.issueId}: ${message}`,
        { ...candidate, error: message },
        candidate.issueId,
      );
      actions.push(`Skipped orphan proposed spec ${candidate.issueId}: spawn-failed`);
    }
  }

    return actions;
  } finally {
    scanInFlight = false;
  }
}

export function clearOrphanProposedAttemptCooldowns(): void {
  attemptCooldowns.clear();
  clearIssueClosedCache();
  scanInFlight = false;
}
