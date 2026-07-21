import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import { loadReviewStatuses, getReviewStatusSync, setReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { messageAgent } from '../agents/messaging.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { surfaceIssueFeedbackNeedsYou } from './feedback-target.js';
import type { StrikeLandingAttempt } from '../strike-landing.js';
import { ensureInternalTokenSync, INTERNAL_TOKEN_HEADER } from '../internal-token.js';
const execFileAsync = promisify(execFile);
export interface StrikeMergeRequest {
  kind: 'strike'; markerHead: string; workspacePath: string; branchName: string; recoveryTarget: string;
}

export interface StrikeMergeResult { success: boolean; mergeStatus?: string; error?: string }
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
    return { success: false, error: `Strike merge request failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export interface StrikeLandingDeps {
  loadStatuses: () => Record<string, ReviewStatus>;
  getStatus: (issueId: string) => ReviewStatus | null;
  setStatus: typeof setReviewStatusSync;
  resolveProject: typeof resolveProjectFromIssueSync;
  mergeIssue: StrikeMergeTrigger;
  getMainHead: (projectPath: string) => Promise<string>;
  deliverRecovery: (agentId: string, message: string) => Promise<void>;
  writeFeedback: (issueId: string, workspacePath: string, markdownBody: string) => Promise<boolean>;
  needsYou: (issueId: string, reason: string, details: Record<string, unknown>) => Promise<void>;
  now: () => string;
  schedule: (key: string, work: () => Promise<void>) => void;
  isScheduled: (key: string) => boolean;
  isPersistentlyOwned: (issueId: string) => boolean;
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

function defaultDeps(): StrikeLandingDeps {
  return {
    loadStatuses: loadReviewStatuses,
    getStatus: getReviewStatusSync,
    setStatus: setReviewStatusSync,
    resolveProject: resolveProjectFromIssueSync,
    mergeIssue: requestStrikeMerge,
    getMainHead: async (projectPath) => (await execFileAsync('git', ['rev-parse', 'origin/main'], { cwd: projectPath, encoding: 'utf8' })).stdout.trim(),
    deliverRecovery: (agentId, message) => messageAgent(agentId, message, 'deacon-strike-landing', { owesRework: true }),
    writeFeedback: async (issueId, workspacePath, markdownBody) => (await Effect.runPromise(writeFeedbackFile({ issueId, workspacePath, specialist: 'merge-agent', outcome: 'needs-you', summary: 'Strike landing needs operator attention', markdownBody }))).success,
    needsYou: surfaceIssueFeedbackNeedsYou,
    now: () => new Date().toISOString(),
    schedule: (key, work) => strikeLandingSupervisor.enqueue(key, work),
    isScheduled: key => strikeLandingSupervisor.has(key),
    isPersistentlyOwned: () => false,
  };
}

const NON_ACTIONABLE = /permission|merge guard|configured project|integration|infrastructure|unavailable|not registered|workspace does not exist/i;
function attemptHistory(attempts: StrikeLandingAttempt[]): string {
  return attempts.map((attempt, index) => `${index + 1}. strike ${attempt.strikeHead}; main ${attempt.mainHead}; ${attempt.outcome}: ${attempt.detail}`).join('\n');
}

async function handleFailure(issueId: string, head: string, detail: string, projectPath: string, workspacePath: string, status: ReviewStatus, deps: StrikeLandingDeps): Promise<string> {
  let mainHead = 'unknown';
  try { mainHead = await deps.getMainHead(projectPath); } catch (error) { detail += `; main HEAD unavailable: ${error instanceof Error ? error.message : String(error)}`; }
  const attempts = [...(status.strikeLandingAttempts ?? []), { timestamp: deps.now(), strikeHead: head, mainHead, outcome: 'failed', detail }];
  const recoveryCount = (status.strikeRecoveryCount ?? 0) + 1;
  const recoveryMessage = `Strike landing failed for ${issueId} at ${head}.\n\nCurrent main: ${mainHead}\nFailure: ${detail}\n\nFetch origin, rebase strike/${issueId.toLowerCase()} onto current origin/main, resolve every conflict, rerun the configured gates, push only strike/${issueId.toLowerCase()}, then run pan strike-ready ${issueId}. A fresh pushed HEAD is required before another landing attempt.`;
  if (!NON_ACTIONABLE.test(detail) && recoveryCount < 3) {
    try {
      await deps.deliverRecovery(`strike-${issueId.toLowerCase()}`, recoveryMessage);
      deps.setStatus(issueId, { strikeLandingState: 'recovering', strikeRecoveryCount: recoveryCount, strikeLandingAttempts: attempts, mergeNotes: detail });
      return `[strike-landing] ${issueId} at ${head} recovering (${recoveryCount}/3)`;
    } catch (error) { detail += `; recovery delivery failed: ${error instanceof Error ? error.message : String(error)}`; attempts[attempts.length - 1] = { ...attempts[attempts.length - 1], detail }; }
  }
  const reason = `Strike landing for ${issueId} needs operator attention after ${recoveryCount} cycle(s).\n${attemptHistory(attempts)}`;
  deps.setStatus(issueId, { strikeLandingState: 'needs_you', strikeRecoveryCount: recoveryCount, strikeLandingAttempts: attempts, mergeNotes: detail });
  await deps.writeFeedback(issueId, workspacePath, `## Strike landing needs operator attention\n\n${reason}`);
  await deps.needsYou(issueId, reason, { attempts });
  return `[strike-landing] ${issueId} at ${head} needs-you`;
}

export async function patrolStrikeLandings(overrides: Partial<StrikeLandingDeps> = {}): Promise<string[]> {
  const deps = { ...defaultDeps(), ...overrides };
  const actions: string[] = [];
  for (const [key, candidate] of Object.entries(deps.loadStatuses())) {
    const issueId = (candidate.issueId || key).toUpperCase();
    const head = candidate.strikeReadyHead;
    if (!head || (candidate.strikeLandingState !== 'ready' && candidate.strikeLandingState !== 'landing')) continue;
    if (candidate.deaconIgnored || candidate.stuck || candidate.mergeStatus === 'merged') continue;

    const current = deps.getStatus(issueId);
    if (current?.strikeReadyHead !== head || (current.strikeLandingState !== 'ready' && current.strikeLandingState !== 'landing')) continue;
    const leaseKey = `${issueId}:${head}`;
    if (current.strikeLandingState === 'landing' && deps.isScheduled(leaseKey)) continue;
    if (current.strikeLandingState === 'landing' && deps.isPersistentlyOwned(issueId)) continue;
    const claimed = current.strikeLandingState === 'ready' ? deps.setStatus(issueId, { strikeLandingState: 'landing' }) : current;
    if (claimed.strikeReadyHead !== head || claimed.strikeLandingState !== 'landing') continue;

    deps.schedule(leaseKey, async () => {
      try { await executeStrikeLanding(issueId, head, claimed, deps); }
      catch (error) {
        const detail = `Unexpected supervised strike landing failure: ${error instanceof Error ? error.message : String(error)}`;
        try {
          const project = deps.resolveProject(issueId);
          await handleFailure(issueId, head, detail, project?.projectPath ?? '', project ? join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}-strike`) : '', deps.getStatus(issueId) ?? claimed, deps);
        } catch (recoveryError) {
          deps.setStatus(issueId, { strikeLandingState: 'needs_you', mergeNotes: `${detail}; durable recovery failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}` });
        }
      }
    });
    actions.push(`[strike-landing] ${candidate.strikeLandingState === 'landing' ? 'reclaimed' : 'claimed'} ${issueId} at ${head}`);
  }
  return actions;
}

async function executeStrikeLanding(issueId: string, head: string, claimed: ReviewStatus, deps: StrikeLandingDeps): Promise<void> {
    const project = deps.resolveProject(issueId);
    if (!project) {
      await handleFailure(issueId, head, `Strike landing could not resolve a configured project for ${issueId}`, '', '', claimed, deps);
      return;
    }
    const request: StrikeMergeRequest = {
      kind: 'strike', markerHead: head,
      workspacePath: join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}-strike`),
      branchName: `strike/${issueId.toLowerCase()}`,
      recoveryTarget: `strike-${issueId.toLowerCase()}`,
    };
    const result = await deps.mergeIssue(issueId, request);
    if (result.mergeStatus === 'merged') {
      deps.setStatus(issueId, { strikeLandingState: 'landed', strikeReadyHead: undefined, strikeReadyAt: undefined });
    } else if (result.success || result.mergeStatus === 'queued' || result.mergeStatus === 'merging' || result.mergeStatus === 'merged') {
      return;
    } else {
      await handleFailure(issueId, head, result.error ?? 'Strike landing failed', project.projectPath, request.workspacePath, claimed, deps);
    }
}
