import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import { listProjectsAsync, resolveProjectFromIssueSync } from '../projects.js';
import { getAgentState } from '../agents/agent-state.js';
import { hasAgentRuntimeInSubtree } from '../agents/runtime-command.js';
import { supervisorProcessAlive } from '../agents/supervisor-liveness.js';
import { listPaneValues } from '../tmux.js';
import { messageAgent, type MessageDeliveryOutcome } from '../agents/messaging.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { surfaceIssueFeedbackNeedsYou } from './feedback-target.js';
import { ensureInternalTokenSync, INTERNAL_TOKEN_HEADER } from '../internal-token.js';
import { getPrFacts } from './pr-facts.js';
const execFileAsync = promisify(execFile);
export interface StrikeMergeRequest {
  kind: 'strike'; markerHead: string; workspacePath: string; branchName: string; recoveryTarget: string;
}

export interface StrikeMergeResult { success: boolean; outcome?: string; error?: string; transport?: boolean }
type StrikeMergeTrigger = (issueId: string, request: StrikeMergeRequest) => Promise<StrikeMergeResult>;

function internalDashboardUrl(): string {
  const port = Number.parseInt(process.env.API_PORT ?? process.env.PORT ?? '3011', 10);
  return process.env.OVERDECK_INTERNAL_DASHBOARD_URL ?? `http://127.0.0.1:${port}`;
}

export async function requestStrikeMerge(
  issueId: string,
  request: StrikeMergeRequest,
  options: { dashboardUrl?: string; token?: string; fetchImpl?: typeof fetch } = {},
): Promise<StrikeMergeResult> {
  const dashboardUrl = options.dashboardUrl ?? internalDashboardUrl();
  const token = options.token ?? ensureInternalTokenSync();
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(new URL(`/api/internal/strikes/${issueId}/merge`, dashboardUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: dashboardUrl,
        [INTERNAL_TOKEN_HEADER]: token,
      },
      body: JSON.stringify(request),
    });
    const body = await response.json() as StrikeMergeResult;
    return typeof body.success === 'boolean'
      ? body
      : { success: false, error: `Strike merge endpoint returned HTTP ${response.status} without a structured result` };
  } catch (error) {
    return {
      success: false,
      transport: true,
      error: `Strike merge request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export interface StrikeLandingDeps {
  resolveProject: typeof resolveProjectFromIssueSync;
  /** The forge's account of the issue's PR — merged strikes are never re-landed. */
  getFacts: (issueId: string) => Promise<{ merged: boolean }>;
  mergeIssue: StrikeMergeTrigger;
  getMainHead: (projectPath: string) => Promise<string>;
  deliverRecovery: (agentId: string, message: string, dedupKey: string) => Promise<MessageDeliveryOutcome>;
  writeFeedback: (issueId: string, workspacePath: string, markdownBody: string) => Promise<boolean>;
  needsYou: (issueId: string, reason: string, details: Record<string, unknown>) => Promise<void>;
  now: () => string;
  schedule: (key: string, work: () => Promise<void>) => void;
  isScheduled: (key: string) => boolean;
  isPersistentlyOwned: (issueId: string) => boolean;
  listProjects: typeof listProjectsAsync;
  git: (args: string[], cwd: string) => Promise<string>;
  isStrikeAgentAlive: (agentId: string) => Promise<boolean>;
}

export class StrikeLandingSupervisor {
  private readonly pending: Array<{ key: string; work: () => Promise<void> }> = [];
  private readonly owned = new Set<string>();
  private active = 0;
  constructor(private readonly concurrency = 2) {}
  has(key: string): boolean { return this.owned.has(key); }
  enqueue(key: string, work: () => Promise<void>): void {
    if (this.owned.has(key)) return;
    this.owned.add(key); this.pending.push({ key, work }); this.drain();
  }
  private drain(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const { key, work } = this.pending.shift()!;
      this.active += 1;
      void work().catch(error => console.error('[strike-landing] supervised work failed:', error)).finally(() => { this.active -= 1; this.owned.delete(key); this.drain(); });
    }
  }
}
const strikeLandingSupervisor = new StrikeLandingSupervisor();

/**
 * A keep-alive tmux shell survives after its harness exits, while a supervisor
 * can keep a harness alive after tmux disappears. Both probes must report no
 * runtime before the Deacon can safely take over a dead strike's branch.
 */
async function defaultIsStrikeAgentAlive(agentId: string): Promise<boolean> {
  try {
    const state = await Effect.runPromise(getAgentState(agentId));
    if (!state) return true;

    const [supervisorAlive, panePids] = await Promise.all([
      supervisorProcessAlive(agentId),
      Effect.runPromise(listPaneValues(agentId, '#{pane_pid}')),
    ]);
    if (supervisorAlive) return true;

    return (await Promise.all(
      panePids.map((panePid) => hasAgentRuntimeInSubtree(panePid, state.harness ?? 'claude-code')),
    )).some(Boolean);
  } catch {
    // A failed liveness probe is not proof that the agent stopped. Fail closed
    // rather than racing an agent whose process tree could not be inspected.
    return true;
  }
}

function defaultDeps(): StrikeLandingDeps {
  return {
    resolveProject: resolveProjectFromIssueSync,
    getFacts: getPrFacts,
    mergeIssue: requestStrikeMerge,
    getMainHead: async (projectPath) => (await execFileAsync('git', ['rev-parse', 'origin/main'], { cwd: projectPath, encoding: 'utf8' })).stdout.trim(),
    // A recovery must arrive through the live delivery door. A keyed message
    // bypasses the monitor mail tier, which only becomes visible if the idle
    // session takes another turn, and makes a repeated patrol safe to retry.
    deliverRecovery: (agentId, message, dedupKey) => messageAgent(agentId, message, 'deacon-strike-landing', { owesRework: true, dedupKey }),
    writeFeedback: async (issueId, workspacePath, markdownBody) => (await Effect.runPromise(writeFeedbackFile({ issueId, workspacePath, specialist: 'merge-agent', outcome: 'needs-you', summary: 'Strike landing needs operator attention', markdownBody }))).success,
    needsYou: surfaceIssueFeedbackNeedsYou,
    now: () => new Date().toISOString(),
    schedule: (key, work) => strikeLandingSupervisor.enqueue(key, work),
    isScheduled: key => strikeLandingSupervisor.has(key),
    isPersistentlyOwned: () => false,
    listProjects: listProjectsAsync,
    git: async (args, cwd) => (await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout.trim(),
    isStrikeAgentAlive: defaultIsStrikeAgentAlive,
  };
}

const TRANSPORT_BACKOFF_BASE_MS = 60_000;
const TRANSPORT_BACKOFF_CAP_MS = 1_800_000;
const MAX_TRANSPORT_RETRIES = 10;
const NON_ACTIONABLE = /permission|merge guard|configured project|integration|infrastructure|unavailable|not registered|workspace does not exist|fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|ETIMEDOUT|EAI_AGAIN/i;
/**
 * PAN-3917: the landing attempt history, the recovery counter, and the transport
 * retry counter all lived on the review row. They are process memory now: a
 * restart forgets them, which is correct — a fresh process re-derives the
 * candidate set from git and retries, and the feedback file plus the needs-you
 * announcement are the durable operator-facing record.
 */
interface StrikeAttempt {
  timestamp: string;
  strikeHead: string;
  mainHead: string;
  outcome: 'failed' | 'transport-failed';
  detail: string;
}

const strikeAttempts = new Map<string, StrikeAttempt[]>();
const strikeRecoveryCounts = new Map<string, number>();
const strikeTransportRetries = new Map<string, number>();
const strikeNextAttemptAt = new Map<string, number>();

/** Test hook: forget every in-process strike landing attempt. */
export function resetStrikeLandingAttemptsForTests(): void {
  strikeAttempts.clear();
  strikeRecoveryCounts.clear();
  strikeTransportRetries.clear();
  strikeNextAttemptAt.clear();
}

function recordAttempt(issueId: string, attempt: StrikeAttempt): StrikeAttempt[] {
  const attempts = [...(strikeAttempts.get(issueId) ?? []), attempt];
  strikeAttempts.set(issueId, attempts);
  return attempts;
}

function attemptHistory(attempts: StrikeAttempt[]): string {
  return attempts.map((attempt, index) => `${index + 1}. strike ${attempt.strikeHead}; main ${attempt.mainHead}; ${attempt.outcome}: ${attempt.detail}`).join('\n');
}

async function handleFailure(issueId: string, head: string, detail: string, projectPath: string, workspacePath: string, deps: StrikeLandingDeps): Promise<string> {
  let mainHead = 'unknown';
  try { mainHead = await deps.getMainHead(projectPath); } catch (error) { detail += `; main HEAD unavailable: ${error instanceof Error ? error.message : String(error)}`; }
  const attempts = recordAttempt(issueId, { timestamp: deps.now(), strikeHead: head, mainHead, outcome: 'failed', detail });
  const recoveryCount = (strikeRecoveryCounts.get(issueId) ?? 0) + 1;
  strikeRecoveryCounts.set(issueId, recoveryCount);
  const recoveryMessage = `Strike landing failed for ${issueId} at ${head}.\n\nCurrent main: ${mainHead}\nFailure: ${detail}\n\nRun pan sync-main ${issueId}, resolve every conflict, rerun the configured gates, push only strike/${issueId.toLowerCase()}, then run pan strike-ready ${issueId}. A fresh pushed HEAD is required before another landing attempt.`;
  if (!NON_ACTIONABLE.test(detail) && recoveryCount < 3) {
    try {
      const outcome = await deps.deliverRecovery(
        `strike-${issueId.toLowerCase()}`,
        recoveryMessage,
        `strike-landing:${issueId}:${head}:${recoveryCount}`,
      );
      if (outcome.delivered) {
        return `[strike-landing] ${issueId} at ${head} recovering (${recoveryCount}/3)`;
      }
      detail += `; recovery not delivered: ${outcome.reason ?? 'queued to mail only'}`;
    } catch (error) { detail += `; recovery delivery failed: ${error instanceof Error ? error.message : String(error)}`; }
  }
  const reason = `Strike landing for ${issueId} needs operator attention after ${recoveryCount} cycle(s).\n${attemptHistory(attempts)}`;
  await deps.writeFeedback(issueId, workspacePath, `## Strike landing needs operator attention\n\n${reason}`);
  await deps.needsYou(issueId, reason, { attempts });
  return `[strike-landing] ${issueId} at ${head} needs-you`;
}

async function handleTransportFailure(issueId: string, head: string, detail: string, deps: StrikeLandingDeps): Promise<string> {
  const timestamp = deps.now();
  const project = deps.resolveProject(issueId);
  const projectPath = project?.projectPath ?? '';
  const workspacePath = project ? join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}-strike`) : '';
  let mainHead = 'unknown';
  try { if (projectPath) mainHead = await deps.getMainHead(projectPath); }
  catch (error) { detail += `; main HEAD unavailable: ${error instanceof Error ? error.message : String(error)}`; }
  const attempts = recordAttempt(issueId, { timestamp, strikeHead: head, mainHead, outcome: 'transport-failed', detail });
  const retryCount = (strikeTransportRetries.get(issueId) ?? 0) + 1;
  strikeTransportRetries.set(issueId, retryCount);

  if (retryCount < MAX_TRANSPORT_RETRIES) {
    const delayMs = Math.min(TRANSPORT_BACKOFF_CAP_MS, TRANSPORT_BACKOFF_BASE_MS * (2 ** (retryCount - 1)));
    strikeNextAttemptAt.set(issueId, Date.parse(timestamp) + delayMs);
    return `[strike-landing] ${issueId} at ${head} transport retry ${retryCount}/${MAX_TRANSPORT_RETRIES} after ${new Date(Date.parse(timestamp) + delayMs).toISOString()}`;
  }

  const reason = `Strike landing for ${issueId} needs operator attention after ${retryCount} transport attempt(s).\n${attemptHistory(attempts)}`;
  strikeNextAttemptAt.delete(issueId);
  await deps.writeFeedback(issueId, workspacePath, `## Strike landing needs operator attention\n\n${reason}`);
  await deps.needsYou(issueId, reason, { attempts });
  return `[strike-landing] ${issueId} at ${head} needs-you`;
}

interface StrandedStrikeCandidate {
  issueId: string;
  branchName: string;
  workspacePath: string;
  head: string;
}

function parseStrikeWorktrees(porcelain: string): Array<{ branchName: string; workspacePath: string }> {
  const worktrees: Array<{ branchName: string; workspacePath: string }> = [];
  let workspacePath: string | undefined;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      workspacePath = line.slice('worktree '.length).trim();
    } else if (workspacePath && line.startsWith('branch refs/heads/strike/')) {
      worktrees.push({
        workspacePath,
        branchName: line.slice('branch refs/heads/'.length).trim(),
      });
    } else if (line.length === 0) {
      workspacePath = undefined;
    }
  }
  return worktrees;
}

async function findStrandedStrikeCandidates(deps: StrikeLandingDeps): Promise<StrandedStrikeCandidate[]> {
  const candidates: StrandedStrikeCandidate[] = [];
  let projects: Awaited<ReturnType<typeof deps.listProjects>>;
  try {
    projects = await deps.listProjects();
  } catch {
    return candidates;
  }

  for (const { config } of projects) {
    let worktrees: Array<{ branchName: string; workspacePath: string }>;
    try {
      worktrees = parseStrikeWorktrees(await deps.git(['worktree', 'list', '--porcelain'], config.path));
    } catch {
      continue;
    }

    for (const { branchName, workspacePath } of worktrees) {
      const issueId = branchName.slice('strike/'.length).toUpperCase();
      if (!/^[A-Z][A-Z0-9]*-\d+$/.test(issueId)) continue;
      if (await deps.isStrikeAgentAlive(`strike-${issueId.toLowerCase()}`)) continue;

      try {
        const [dirty, ahead, head] = await Promise.all([
          deps.git(['status', '--porcelain'], workspacePath),
          deps.git(['rev-list', '--count', 'origin/main..HEAD'], workspacePath),
          deps.git(['rev-parse', 'HEAD'], workspacePath),
        ]);
        if (dirty || Number(ahead) <= 0 || !/^[0-9a-f]{40}$/i.test(head)) continue;
        candidates.push({ issueId, branchName, workspacePath, head });
      } catch {
        // Cannot prove that this worktree is clean and ahead of main. Leave it
        // untouched for a later patrol rather than guessing at agent intent.
      }
    }
  }
  return candidates;
}

/**
 * Push a completed strike whose harness exited before it could finish the
 * commit → push → strike-ready handoff. PAN-3917: the push itself is the
 * evidence — git shows the branch on origin — so nothing is stamped.
 */
export async function salvageStrandedStrikeBranches(deps: StrikeLandingDeps): Promise<string[]> {
  const actions: string[] = [];
  for (const candidate of await findStrandedStrikeCandidates(deps)) {
    // PAN-3903/PAN-3898: salvage INITIATES a landing. A strike whose PR already
    // merged is not salvage's to re-arm.
    if ((await deps.getFacts(candidate.issueId)).merged) continue;
    if (salvagedStrikeHeads.get(candidate.issueId) === candidate.head) continue;

    // Recheck immediately before the push to narrow the liveness race with an
    // agent that may have resumed after the initial branch scan.
    if (await deps.isStrikeAgentAlive(`strike-${candidate.issueId.toLowerCase()}`)) continue;

    try {
      const [dirty, head] = await Promise.all([
        deps.git(['status', '--porcelain'], candidate.workspacePath),
        deps.git(['rev-parse', 'HEAD'], candidate.workspacePath),
      ]);
      if (dirty || head !== candidate.head) continue;

      await deps.git(['push', 'origin', candidate.branchName], candidate.workspacePath);
      salvagedStrikeHeads.set(candidate.issueId, candidate.head);
      strikeRecoveryCounts.delete(candidate.issueId);
      strikeTransportRetries.delete(candidate.issueId);
      strikeNextAttemptAt.delete(candidate.issueId);
      actions.push(`[strike-salvage] pushed ${candidate.issueId} at ${candidate.head}`);
    } catch (error) {
      console.warn(`[strike-salvage] could not push ${candidate.issueId} at ${candidate.head}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return actions;
}

/**
 * Land every strike branch that git says is ready and the forge says has not
 * merged. PAN-3917: the candidate set is derived every pass — clean strike
 * worktree, ahead of main, no live strike agent — instead of being claimed and
 * released through `strikeLandingState` on a row. The in-process supervisor
 * lease is what keeps two passes from landing the same head twice.
 */
export async function patrolStrikeLandings(overrides: Partial<StrikeLandingDeps> = {}): Promise<string[]> {
  const deps = { ...defaultDeps(), ...overrides };
  const actions = await salvageStrandedStrikeBranches(deps);
  const nowMs = Date.parse(deps.now());

  for (const candidate of await findStrandedStrikeCandidates(deps)) {
    const { issueId, head } = candidate;
    const nextAttemptAt = strikeNextAttemptAt.get(issueId);
    if (nextAttemptAt && nextAttemptAt > nowMs) continue;
    if ((await deps.getFacts(issueId)).merged) continue;

    const leaseKey = `${issueId}:${head}`;
    if (deps.isScheduled(leaseKey)) continue;
    if (deps.isPersistentlyOwned(issueId)) continue;

    deps.schedule(leaseKey, async () => {
      try { await executeStrikeLanding(issueId, head, deps); }
      catch (error) {
        const detail = `Unexpected supervised strike landing failure: ${error instanceof Error ? error.message : String(error)}`;
        const project = deps.resolveProject(issueId);
        await handleFailure(
          issueId,
          head,
          detail,
          project?.projectPath ?? '',
          project ? join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}-strike`) : '',
          deps,
        ).catch((recoveryError) => {
          console.error(`[strike-landing] ${issueId}: ${detail}; durable recovery failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
        });
      }
    });
    actions.push(`[strike-landing] claimed ${issueId} at ${head}`);
  }
  return actions;
}

async function executeStrikeLanding(issueId: string, head: string, deps: StrikeLandingDeps): Promise<void> {
    const project = deps.resolveProject(issueId);
    if (!project) {
      await handleFailure(issueId, head, `Strike landing could not resolve a configured project for ${issueId}`, '', '', deps);
      return;
    }
    const request: StrikeMergeRequest = {
      kind: 'strike', markerHead: head,
      workspacePath: join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}-strike`),
      branchName: `strike/${issueId.toLowerCase()}`,
      recoveryTarget: `strike-${issueId.toLowerCase()}`,
    };
    const result = await deps.mergeIssue(issueId, request);
    if (result.outcome === 'merged' || result.success || result.outcome === 'queued' || result.outcome === 'merging') {
      strikeNextAttemptAt.delete(issueId);
      strikeTransportRetries.delete(issueId);
      return;
    }
    if (result.transport) {
      // A transport failure may still have landed the merge — ask the forge
      // before counting a retry.
      if ((await deps.getFacts(issueId)).merged) {
        strikeNextAttemptAt.delete(issueId);
        strikeTransportRetries.delete(issueId);
        return;
      }
      await handleTransportFailure(issueId, head, result.error ?? 'Strike landing transport failed', deps);
      return;
    }
    await handleFailure(issueId, head, result.error ?? 'Strike landing failed', project.projectPath, request.workspacePath, deps);
}

/** Heads already pushed by salvage in this process, so a pass does not re-push. */
const salvagedStrikeHeads = new Map<string, string>();
