import { exec } from 'child_process';
import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { readFileSync, readdirSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';
import { promisify } from 'util';
import { Effect } from 'effect';

import { getAgentState, type AgentState } from '../agents.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { listProjects, resolveProjectFromIssueSync, type ProjectConfig } from '../projects.js';
import { getReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { listSessionNames } from '../tmux.js';
import { findPlanSync, readPlanSync } from '../vbrief/io.js';
import type { VBriefDocument } from '../vbrief/types.js';
import { loadCloisterConfig } from './config.js';
import { clearIssueClosedCache, isIssueClosed } from './issue-closed.js';

const DEFAULT_ATTEMPT_INTERVAL_MS = 5 * 60 * 1000;
const execAsync = promisify(exec);
const attemptCooldowns = new Map<string, number>();
const terminalClosedIssueIds = new Set<string>();
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

export type ReviewPipelinePresenceStatus = Pick<ReviewStatus,
  'reviewStatus' | 'testStatus' | 'mergeStatus' | 'readyForMerge' | 'prNumber' | 'prUrl'
>;

export function hasReviewPipelinePresence(status: ReviewPipelinePresenceStatus | null): boolean {
  if (!status) return false;
  if (status.reviewStatus !== 'pending') return true;
  if (status.testStatus !== 'pending') return true;
  if (status.mergeStatus && status.mergeStatus !== 'pending') return true;
  if (status.readyForMerge === true) return true;
  if (status.prNumber != null) return true;
  if (typeof status.prUrl === 'string' && status.prUrl.trim().length > 0) return true;
  return false;
}

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
  getReviewStatusForIssue?: (issueId: string) => ReviewPipelinePresenceStatus | null;
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
  hasOpenPrForBranch?: (projectPath: string, issueId: string) => Promise<boolean>;
  dashboardOrigin?: string;
}

export interface HandleOrphanProposedSpecOptions {
  spawnWorkAgent?: (issueId: string) => Promise<SpawnWorkAgentResult>;
  hasOpenPrForBranch?: (projectPath: string, issueId: string) => Promise<boolean>;
  dashboardOrigin?: string;
  config?: OrphanProposedReconcilerConfig;
  /** Project override for tests / callers that already resolved the issue. */
  project?: { projectKey: string; projectPath: string };
  /** Spec override so the safety net does not re-read the file. */
  spec?: { path: string; doc: VBriefDocument };
}

async function findSpecPathForIssue(projectPath: string, issueId: string): Promise<string | null> {
  const specsDir = join(projectPath, '.pan', 'specs');
  if (!existsSync(specsDir)) return null;
  let filenames: string[];
  try {
    filenames = readdirSync(specsDir);
  } catch {
    return null;
  }
  for (const filename of filenames) {
    if (!filename.endsWith('.vbrief.json')) continue;
    const specPath = join(specsDir, filename);
    try {
      const doc = readPlanSync(specPath);
      if (normalizeIssueId(doc.plan?.id) === issueId.toUpperCase()) {
        return specPath;
      }
    } catch {
      // ignore unreadable specs
    }
  }
  return null;
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

function hasIssueScopedSession(tmuxSessionNames: readonly string[], agentId: string): boolean {
  return tmuxSessionNames.some((sessionName) => sessionName === agentId || sessionName.startsWith(`${agentId}-`));
}

async function defaultHasOpenPrForBranch(projectPath: string, issueId: string): Promise<boolean> {
  const branch = `feature/${issueId.toLowerCase()}`;

  try {
    const result = await execAsync(`gh pr list --head ${branch} --state open --json number --limit 1`, { cwd: projectPath }) as { stdout?: string } | string;
    const stdout = typeof result === 'string' ? result : result.stdout;
    const prs = JSON.parse(stdout ?? '[]') as unknown;
    return Array.isArray(prs) && prs.length > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logReconcilerDiagnostic('open-pr-check-failed', { projectPath, issueId, branch, error: message });
    return false;
  }
}

export async function findOrphanProposedSpecsForReconciler(options: FindOrphanProposedOptions = {}): Promise<OrphanProposedCandidate[]> {
  const projects = await loadProjectsForScan(options.projects);
  const tmuxSessionNames = await loadTmuxSessionNames(options.tmuxSessionNames);
  const getState = options.getAgentStateForIssue ?? defaultGetAgentState;
  const getReviewStatus = options.getReviewStatusForIssue ?? getReviewStatusSync;
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
      if (hasIssueScopedSession(tmuxSessionNames, agentId)) continue;
      if (state?.status === 'starting' || state?.status === 'running') continue;
      if (state?.paused === true || state?.troubled === true) continue;
      if (hasReviewPipelinePresence(getReviewStatus(issueId))) {
        logReconcilerDiagnostic('candidate-excluded', { issueId, reason: 'review-pipeline-presence' });
        continue;
      }
      if (terminalClosedIssueIds.has(issueId)) continue;
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
  return process.env['OVERDECK_INTERNAL_DASHBOARD_URL'] ?? `http://127.0.0.1:${port}`;
}

function classifySpawnSkip(status: number, body: Record<string, unknown>): string {
  const error = typeof body['error'] === 'string' ? body['error'] : '';
  if (body['stackHealth'] || /workspace docker stack/i.test(error)) return 'stack-unhealthy';
  if (body['paused'] === true) return 'paused';
  if (body['troubled'] === true) return 'troubled';
  if (body['guardrails'] || body['requiresAcknowledgement'] === true || status === 409) return 'guardrails';
  if (body['providerHealth']) return 'provider-down';
  if (status === 422 && /already closed|closed issue|cannot start an agent for a closed issue/i.test(error)) return 'closed-issue';
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

/**
 * PAN-1908: reactive orphan-proposed handler. When a spec reaches `proposed`
 * and no work agent is running/starting, spawn a work agent for that issue
 * without scanning all project specs.
 */
export async function handleOrphanProposedSpec(
  issueId: string,
  options: HandleOrphanProposedSpecOptions = {},
): Promise<string[]> {
  const upperIssueId = issueId.trim().toUpperCase();
  if (!upperIssueId) return [];

  const loadedConfig = options.config ?? await Effect.runPromise(
    loadCloisterConfig().pipe(
      Effect.map(config => config.orphanProposedReconciler ?? { enabled: true, minAttemptIntervalMs: DEFAULT_ATTEMPT_INTERVAL_MS }),
      Effect.catch(() => Effect.succeed({ enabled: true, minAttemptIntervalMs: DEFAULT_ATTEMPT_INTERVAL_MS })),
    ),
  );
  if (loadedConfig.enabled === false) return [];

  const now = Date.now();
  const minAttemptIntervalMs = Math.max(loadedConfig.minAttemptIntervalMs ?? DEFAULT_ATTEMPT_INTERVAL_MS, DEFAULT_ATTEMPT_INTERVAL_MS);
  const lastAttempt = attemptCooldowns.get(upperIssueId);
  if (lastAttempt !== undefined && now - lastAttempt < minAttemptIntervalMs) {
    logReconcilerDiagnostic('spawn-skipped', { issueId: upperIssueId, reason: 'cooldown' });
    return [];
  }

  const resolved = options.project ?? resolveProjectFromIssueSync(upperIssueId);
  if (!resolved) {
    logReconcilerDiagnostic('spawn-skipped', { issueId: upperIssueId, reason: 'no-project' });
    return [];
  }
  const projectPath = resolved.projectPath;
  const projectKey = resolved.projectKey;

  const issueLower = upperIssueId.toLowerCase();

  let planDoc: VBriefDocument;
  let planPath: string | null;
  if (options.spec) {
    planPath = options.spec.path;
    planDoc = options.spec.doc;
  } else {
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    planPath = findPlanSync(workspacePath) ?? await findSpecPathForIssue(projectPath, upperIssueId);
    if (!planPath) {
      logReconcilerDiagnostic('spawn-skipped', { issueId: upperIssueId, reason: 'no-spec' });
      return [];
    }

    try {
      planDoc = readPlanSync(planPath);
    } catch {
      logReconcilerDiagnostic('spawn-skipped', { issueId: upperIssueId, reason: 'spec-unreadable' });
      return [];
    }
  }

  if (planDoc.plan?.status !== 'proposed') {
    logReconcilerDiagnostic('spawn-skipped', { issueId: upperIssueId, reason: 'not-proposed', status: planDoc.plan?.status });
    return [];
  }

  const agentId = `agent-${issueLower}`;

  // PAN-1908: prefer agents-table state (fast) but fall back to state.json.
  const agentState = await Effect.runPromise(
    getAgentState(agentId).pipe(Effect.catch(() => Effect.succeed(null))),
  );
  if (agentState?.status === 'starting' || agentState?.status === 'running') {
    logReconcilerDiagnostic('spawn-skipped', { issueId: upperIssueId, reason: 'agent-active' });
    return [];
  }
  if (agentState?.paused === true || agentState?.troubled === true) {
    logReconcilerDiagnostic('spawn-skipped', { issueId: upperIssueId, reason: agentState.paused ? 'paused' : 'troubled' });
    return [];
  }

  // Any tmux session for the issue means the pipeline is active here.
  const sessions = await Effect.runPromise(listSessionNames().pipe(Effect.catch(() => Effect.succeed([]))));
  if (hasIssueScopedSession(sessions, agentId)) {
    logReconcilerDiagnostic('spawn-skipped', { issueId: upperIssueId, reason: 'issue-scoped-session' });
    return [];
  }

  if (hasReviewPipelinePresence(getReviewStatusSync(upperIssueId))) {
    logReconcilerDiagnostic('candidate-excluded', { issueId: upperIssueId, reason: 'review-pipeline-presence' });
    return [];
  }

  if (terminalClosedIssueIds.has(upperIssueId)) {
    logReconcilerDiagnostic('spawn-skipped', { issueId: upperIssueId, reason: 'terminal-closed' });
    return [];
  }
  if (await isIssueClosed(upperIssueId)) {
    terminalClosedIssueIds.add(upperIssueId);
    logReconcilerDiagnostic('spawn-skipped', { issueId: upperIssueId, reason: 'closed' });
    return [];
  }

  const planItems = Array.isArray(planDoc.plan?.items) ? planDoc.plan.items : [];
  const planItemCount = planItems.length;
  const beadCount = await countBeadsForIssue(resolved.projectPath, upperIssueId);
  if (planItemCount === 0 || beadCount !== planItemCount) {
    logReconcilerDiagnostic('spawn-skipped', { issueId: upperIssueId, reason: 'bead-mismatch', planItemCount, beadCount });
    return [];
  }

  try {
    if (await (options.hasOpenPrForBranch ?? defaultHasOpenPrForBranch)(projectPath, upperIssueId)) {
      logReconcilerDiagnostic('spawn-skipped', { issueId: upperIssueId, reason: 'open-pr' });
      return [`Skipped orphan proposed spec ${upperIssueId}: open-pr`];
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logReconcilerDiagnostic('open-pr-check-failed', { issueId: upperIssueId, error: message });
  }

  attemptCooldowns.set(upperIssueId, now);

  try {
    const spawn = await (options.spawnWorkAgent ?? ((id) => spawnWorkAgentThroughAgentsEndpoint(id, options.dashboardOrigin)))(upperIssueId);
    if (spawn.spawned) {
      emitReconcilerActivity(
        'success',
        `Started work agent for ${upperIssueId} — proposed spec had tasks but no running agent`,
        { issueId: upperIssueId, agentId: spawn.agentId, projectKey, projectPath },
        upperIssueId,
      );
      return [`Spawned work agent for orphan proposed spec ${upperIssueId}`];
    }

    const reason = spawn.skippedReason ?? 'spawn-failed';
    if (reason === 'closed-issue') {
      terminalClosedIssueIds.add(upperIssueId);
      logReconcilerDiagnostic('spawn-skipped', { issueId: upperIssueId, reason, error: spawn.error });
      return [`Skipped orphan proposed spec ${upperIssueId}: ${reason}`];
    }
    emitReconcilerActivity(
      'warn',
      `Couldn't start work agent for ${upperIssueId}: ${reason}`,
      { issueId: upperIssueId, error: spawn.error, projectKey, projectPath },
      upperIssueId,
    );
    return [`Skipped orphan proposed spec ${upperIssueId}: ${reason}`];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitReconcilerActivity(
      'error',
      `Couldn't start work agent for ${upperIssueId}: ${message}`,
      { issueId: upperIssueId, projectKey, projectPath },
      upperIssueId,
    );
    return [`Skipped orphan proposed spec ${upperIssueId}: spawn-failed`];
  }
}

/**
 * PAN-1908: thin dropped-event safety net for orphan proposed specs. The
 * primary path is reactive via handleOrphanProposedSpec on
 * issue.statusChanged(todo). This net finds candidate issueIds and delegates
 * to the same handler so the eligibility logic lives in one place.
 */
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
    const actions: string[] = [];
    const candidates = await findOrphanProposedSpecsForReconciler(options);

    for (const candidate of candidates) {
      let planDoc: VBriefDocument;
      try {
        planDoc = readPlanSync(candidate.specPath);
      } catch {
        logReconcilerDiagnostic('spawn-skipped', { issueId: candidate.issueId, reason: 'spec-unreadable' });
        continue;
      }

      const result = await handleOrphanProposedSpec(candidate.issueId, {
        spawnWorkAgent: options.spawnWorkAgent,
        hasOpenPrForBranch: options.hasOpenPrForBranch,
        dashboardOrigin: options.dashboardOrigin,
        config: { enabled: true, minAttemptIntervalMs: loadedConfig.minAttemptIntervalMs },
        project: { projectKey: candidate.projectKey, projectPath: candidate.projectPath },
        spec: { path: candidate.specPath, doc: planDoc },
      });
      actions.push(...result);
    }

    return actions;
  } finally {
    scanInFlight = false;
  }
}

export function clearOrphanProposedAttemptCooldowns(): void {
  attemptCooldowns.clear();
  terminalClosedIssueIds.clear();
  clearIssueClosedCache();
  scanInFlight = false;
}
