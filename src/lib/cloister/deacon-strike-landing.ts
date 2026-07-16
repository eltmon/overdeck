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
const execFileAsync = promisify(execFile);
export interface StrikeMergeRequest {
  kind: 'strike'; markerHead: string; workspacePath: string; branchName: string; recoveryTarget: string;
}

export interface StrikeMergeResult { success: boolean; mergeStatus?: string; error?: string }
type StrikeMergeTrigger = (issueId: string, request: StrikeMergeRequest) => Promise<StrikeMergeResult>;
let strikeMergeTrigger: StrikeMergeTrigger | null = null;

export function registerStrikeMergeTrigger(trigger: StrikeMergeTrigger): void { strikeMergeTrigger = trigger; }

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
  schedule: (work: () => Promise<void>) => void;
}

export class StrikeLandingSupervisor {
  private readonly pending: Array<() => Promise<void>> = [];
  private active = 0;
  constructor(private readonly concurrency = 2) {}
  enqueue(work: () => Promise<void>): void { this.pending.push(work); this.drain(); }
  private drain(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const work = this.pending.shift()!;
      this.active += 1;
      void work().catch(error => console.error('[strike-landing] supervised work failed:', error)).finally(() => { this.active -= 1; this.drain(); });
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
    mergeIssue: async (issueId, request) => strikeMergeTrigger
      ? strikeMergeTrigger(issueId, request)
      : { success: false, error: 'Strike merge trigger is not registered' },
    getMainHead: async (projectPath) => (await execFileAsync('git', ['rev-parse', 'origin/main'], { cwd: projectPath, encoding: 'utf8' })).stdout.trim(),
    deliverRecovery: (agentId, message) => messageAgent(agentId, message, 'deacon-strike-landing', { owesRework: true }),
    writeFeedback: async (issueId, workspacePath, markdownBody) => (await Effect.runPromise(writeFeedbackFile({ issueId, workspacePath, specialist: 'merge-agent', outcome: 'needs-you', summary: 'Strike landing needs operator attention', markdownBody }))).success,
    needsYou: surfaceIssueFeedbackNeedsYou,
    now: () => new Date().toISOString(),
    schedule: work => strikeLandingSupervisor.enqueue(work),
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
    if (!head || candidate.strikeLandingState !== 'ready') continue;
    if (candidate.deaconIgnored || candidate.stuck || candidate.mergeStatus === 'merged') continue;

    const current = deps.getStatus(issueId);
    if (current?.strikeReadyHead !== head || current.strikeLandingState !== 'ready') continue;
    const claimed = deps.setStatus(issueId, { strikeLandingState: 'landing' });
    if (claimed.strikeReadyHead !== head || claimed.strikeLandingState !== 'landing') continue;

    deps.schedule(async () => executeStrikeLanding(issueId, head, claimed, deps));
    actions.push(`[strike-landing] claimed ${issueId} at ${head}`);
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
