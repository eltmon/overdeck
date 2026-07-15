import { Effect } from 'effect';

import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { getReviewStatusSync } from '../../dashboard/server/review-status.js';
import type { IssueDataService } from '../../dashboard/server/services/issue-data-service.js';
import { getSharedIssueService } from '../../dashboard/server/services/issue-service-singleton.js';
import { EventStoreService } from '../../dashboard/server/services/domain-services.js';
import { getRallyConfig } from '../../dashboard/server/services/tracker-config.js';
import type { LifecycleContext, StepResult, WorkflowResult } from '../lifecycle/types.js';
import type { DodRowId } from '../lifecycle/dod.js';
import { withConcurrencyLimit } from '../concurrency.js';
import { getAgentState, normalizeAgentId } from '../agents.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';
import { sessionExists } from '../tmux.js';
import { resolveIssueProjectPathSync } from './issue-reads.js';

function getIssueDataService(): IssueDataService {
  return getSharedIssueService();
}

function isGitHubIssue(issueId: string): {
  isGitHub: boolean;
  owner?: string;
  repo?: string;
  number?: number;
} {
  const resolved = resolveGitHubIssueSync(issueId);
  if (resolved.isGitHub) {
    return { isGitHub: true, owner: resolved.owner, repo: resolved.repo, number: resolved.number };
  }
  return { isGitHub: false };
}

function buildCloseOutContext(id: string): LifecycleContext | null {
  const resolvedProject = resolveProjectFromIssueSync(id);
  if (!resolvedProject) return null;

  const githubCheck = isGitHubIssue(id);
  return {
    issueId: id,
    projectPath: resolvedProject.projectPath,
    projectName: resolvedProject.projectName,
    ...(githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number
      ? { github: { owner: githubCheck.owner, repo: githubCheck.repo, number: githubCheck.number } }
      : {}),
  };
}

function closeOutFailureResponse(result: WorkflowResult) {
  const failedStep = result.steps.find((s: StepResult) => !s.success && !s.skipped);
  return jsonResponse({
    ...result,
    error: failedStep?.error ?? 'Close-out workflow failed',
    failedStep,
  }, { status: 422 });
}

const CLOSED_OUT_CACHE_WORKFLOW_LABELS = new Set([
  'in-review',
  'in-progress',
  'needs-close-out',
  'verifying-on-main',
]);

function buildClosedOutCacheLabels(labels: string[]): string[] {
  return [
    ...labels.filter((label) => {
      const normalized = label.toLowerCase();
      return normalized !== 'closed-out' && !CLOSED_OUT_CACHE_WORKFLOW_LABELS.has(normalized);
    }),
    'closed-out',
  ];
}

function sanitizeCloseOutError(error: unknown): string {
  console.error('Close-out route failed:', error);
  return 'Internal server error';
}

function getCachedIssueForCloseOut(issueDataService: IssueDataService, issueId: string): any | undefined {
  return issueDataService.getIssues().find(
    (issue: any) => String(issue.identifier ?? issue.id ?? '').toUpperCase() === issueId.toUpperCase(),
  );
}

function isCachedIssueClosedOut(issue: any | undefined): boolean {
  return Array.isArray(issue?.labels)
    && issue.labels.some((label: unknown) => String(label).toLowerCase() === 'closed-out');
}

function closeOutAlreadyCompletedResult(issueId: string): WorkflowResult {
  return {
    workflow: 'close-out',
    issueId,
    success: true,
    steps: [{ step: 'close-out:idempotent', success: true, skipped: true, details: ['Issue already closed out'] }],
    duration: 0,
  };
}

export function closeOutIssue(id: string, opts: { acceptedRows?: DodRowId[]; acceptedBy?: string } = {}) {
  return Effect.gen(function* () {
    const ctx = buildCloseOutContext(id);
    if (!ctx) {
      return jsonResponse({ error: `Could not resolve project for ${id}` }, { status: 404 });
    }

    const eventStore = yield* EventStoreService;
    const issueDataService = getIssueDataService();
    if (isCachedIssueClosedOut(getCachedIssueForCloseOut(issueDataService, id))) {
      return jsonResponse(closeOutAlreadyCompletedResult(id));
    }
    const issueSource = issueDataService.getIssueSource(id);

    if (issueSource === 'rally') {
      const rallyConfig = getRallyConfig();
      if (rallyConfig) {
        ctx.rally = {
          apiKey: rallyConfig.apiKey,
          server: rallyConfig.server,
          workspace: rallyConfig.workspace,
          project: rallyConfig.project,
        };
      }
    }

    const closeOutResult = yield* Effect.promise(async () => {
      try {
        const { closeOut } = await import('../lifecycle/index.js');
        // PAN-1249: closeOut returns Effect<WorkflowResult>; bridge to Promise.
        const result = await Effect.runPromise(closeOut(ctx, {
          dodAcceptedRows: opts.acceptedRows,
          dodAcceptedBy: opts.acceptedBy ?? 'dashboard-operator',
        }));
        return { ok: true as const, result };
      } catch (error) {
        return { ok: false as const, error };
      }
    });

    if (!closeOutResult.ok) {
      return jsonResponse({ error: sanitizeCloseOutError(closeOutResult.error) }, { status: 500 });
    }

    const result = closeOutResult.result;
    if (!result.success) {
      return closeOutFailureResponse(result);
    }

    let newLabels: string[] = ['closed-out'];
    try {
      const cachedIssues = issueDataService.getIssues();
      const cachedIssue = cachedIssues.find(
        (i: any) => (i.identifier || '').toUpperCase() === id.toUpperCase()
      );
      const currentLabels: string[] = cachedIssue?.labels || [];
      newLabels = buildClosedOutCacheLabels(currentLabels);
      issueDataService.patchIssue(id, {
        status: 'Done',
        state: 'done',
        canonicalStatus: 'done',
        targetCanonicalState: 'done',
        mergeStatus: undefined,
        labels: newLabels,
      });
    } catch { /* non-fatal */ }

    yield* eventStore.append({
      type: 'issue.statusChanged',
      timestamp: new Date().toISOString(),
      payload: { issueId: id, status: 'Done', state: 'done', canonicalStatus: 'done', labels: newLabels },
    });

    issueDataService.invalidateTracker('github').catch(() => {});
    issueDataService.invalidateTracker('linear').catch(() => {});
    issueDataService.invalidateTracker('rally').catch(() => {});

    return jsonResponse(result);
  });
}

const MAX_BULK_CLOSE_OUT = 50;

const VALID_TMUX_NAME_RE = /^[a-zA-Z0-9._-]+$/;

/** Normalize an issue ID to a planning session name, mirroring normalizeAgentId logic. */
function normalizePlanningId(issueId: string): string {
  if (issueId.startsWith('planning-')) return issueId;
  return `planning-${issueId.toLowerCase()}`;
}

function isInactiveAgentStatus(status: string | undefined): boolean {
  return status === 'dead' || status === 'stopped' || status === 'failed';
}

function isPausedMergedAgentSafe(agentState: { paused?: boolean } | null | undefined, allowPausedMerged: boolean): boolean {
  return allowPausedMerged && agentState?.paused === true;
}

async function hasActiveAgentForIssue(issueId: string, allowPausedMerged = false): Promise<boolean> {
  const agentId = normalizeAgentId(issueId);
  const planningId = normalizePlanningId(issueId);

  return Effect.runPromise(Effect.gen(function* () {
    // Only query tmux for valid session names (GitHub IDs like owner/repo#123 produce invalid names)
    if (VALID_TMUX_NAME_RE.test(agentId) && (yield* sessionExists(agentId))) return true;
    if (VALID_TMUX_NAME_RE.test(planningId) && (yield* sessionExists(planningId))) return true;

    const agentState = yield* getAgentState(agentId);
    if (agentState && !isInactiveAgentStatus(agentState.status) && !isPausedMergedAgentSafe(agentState, allowPausedMerged)) return true;

    const planningState = yield* getAgentState(planningId);
    if (planningState && !isInactiveAgentStatus(planningState.status) && !isPausedMergedAgentSafe(planningState, allowPausedMerged)) return true;

    return false;
  }));
}

/** Validate issue ID format (PAN-123, TEAM-456, or GitHub owner/repo#number) */
function isValidIssueId(id: string): boolean {
  if (typeof id !== 'string') return false;
  // Linear-style: PREFIX-123
  if (/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(id)) return true;
  // GitHub-style: owner/repo#number (alphanumeric, hyphens, underscores, periods only)
  if (/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+#\d+$/.test(id)) return true;
  return false;
}

export function bulkCloseOut(body: Record<string, unknown>) {
  return Effect.gen(function* () {
    const rawIssueIds = Array.isArray(body.issueIds) ? body.issueIds : [];
    const issueIds = [...new Set(rawIssueIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))];

    // Input validation
    if (issueIds.length === 0) {
      return jsonResponse({ error: 'issueIds array is required' }, { status: 400 });
    }
    if (issueIds.length > MAX_BULK_CLOSE_OUT) {
      return jsonResponse({ error: `Maximum ${MAX_BULK_CLOSE_OUT} issues allowed` }, { status: 400 });
    }

    const invalidIds = issueIds.filter(id => !isValidIssueId(id));
    if (invalidIds.length > 0) {
      return jsonResponse({ error: `Invalid issue ID format: ${invalidIds.join(', ')}` }, { status: 400 });
    }

    const eventStore = yield* EventStoreService;
    const { closeOut } = yield* Effect.promise(() => import('../lifecycle/index.js'));
    const issueDataService = getIssueDataService();

    // Pre-validate all issues: run agent checks in parallel, then build contexts.
    // CloseOut runs with bounded concurrency (max 3) to avoid unbounded
    // resource use while keeping git index-lock risk low for independent issues.
    type CloseOutTask = { id: string; ctx: LifecycleContext } | { id: string; skipped: true; error: string };
    const tasks: CloseOutTask[] = [];

    const agentChecks = yield* withConcurrencyLimit(
      issueIds.map(id => Effect.promise(async () => {
        const cachedIssue = issueDataService.getIssues().find(
          (issue: any) => (issue.identifier || '').toUpperCase() === id.toUpperCase(),
        );
        const reviewStatus = getReviewStatusSync(id.toUpperCase());
        const allowPausedMerged = reviewStatus?.mergeStatus === 'merged' || cachedIssue?.mergeStatus === 'merged';
        const hasActiveAgent = await hasActiveAgentForIssue(id, allowPausedMerged);
        return { id, hasActiveAgent };
      })),
      10
    );

    for (const { id, hasActiveAgent } of agentChecks) {
      if (hasActiveAgent) {
        tasks.push({ id, skipped: true, error: 'Skipped: active agent running' });
        continue;
      }

      const githubCheck = isGitHubIssue(id);
      const projectPath = resolveIssueProjectPathSync(id);
      if (!projectPath) {
        tasks.push({ id, skipped: true, error: `Could not resolve project path for ${id}` });
        continue;
      }

      const ctx: LifecycleContext = {
        issueId: id,
        projectPath,
        ...(githubCheck.isGitHub && githubCheck.owner && githubCheck.repo && githubCheck.number
          ? { github: { owner: githubCheck.owner, repo: githubCheck.repo, number: githubCheck.number } }
          : {}),
      };

      const issueSource = issueDataService.getIssueSource(id);
      if (issueSource === 'rally') {
        const rallyConfig = getRallyConfig();
        if (rallyConfig) {
          ctx.rally = {
            apiKey: rallyConfig.apiKey,
            server: rallyConfig.server,
            workspace: rallyConfig.workspace,
            project: rallyConfig.project,
          };
        }
      }

      tasks.push({ id, ctx });
    }

    const closeOutTasks = tasks
      .filter((t): t is { id: string; ctx: LifecycleContext } => !('skipped' in t))
      .map(({ id, ctx }) => Effect.promise(async () => {
        try {
          const closeResult = await Effect.runPromise(closeOut(ctx));
          return { id, closeResult };
        } catch (error) {
          const closeResult: WorkflowResult = {
            workflow: 'close-out',
            issueId: id,
            success: false,
            steps: [{
              step: 'close-out',
              success: false,
              skipped: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }],
            duration: 0,
          };
          return { id, closeResult };
        }
      }));

    const closeOutResults = yield* withConcurrencyLimit(closeOutTasks, 3);

    const results: Array<{ issueId: string; success: boolean; error?: string; skipped: boolean }> = [];
    for (const { id, closeResult } of closeOutResults) {
      if (closeResult.success) {
        let newLabels: string[] = ['closed-out'];
        try {
          const cachedIssues = issueDataService.getIssues();
          const cachedIssue = cachedIssues.find(
            (i: any) => (i.identifier || '').toUpperCase() === id.toUpperCase()
          );
          const currentLabels: string[] = cachedIssue?.labels || [];
          newLabels = buildClosedOutCacheLabels(currentLabels);
          issueDataService.patchIssue(id, {
            status: 'Done',
            state: 'done',
            canonicalStatus: 'done',
            targetCanonicalState: 'done',
            mergeStatus: undefined,
            labels: newLabels,
          });
        } catch (e) {
          console.error('Failed to patch issue status:', e);
        }
        yield* eventStore.append({
          type: 'issue.statusChanged',
          timestamp: new Date().toISOString(),
          payload: { issueId: id, status: 'Done', state: 'done', canonicalStatus: 'done', labels: newLabels },
        });
      }

      const failedStep = closeResult.steps.find((s: StepResult) => !s.success);
      results.push({
        issueId: id,
        success: closeResult.success,
        error: closeResult.success ? undefined : failedStep?.error,
        skipped: false,
      });
    }

    for (const task of tasks) {
      if ('skipped' in task) {
        results.push({ issueId: task.id, success: false, error: task.error, skipped: true });
      }
    }

    // Invalidate trackers once if any issue closed successfully
    const anySucceeded = results.some(r => r.success);
    if (anySucceeded) {
      issueDataService.invalidateTracker('github').catch((e: Error) => { console.error('Failed to invalidate github tracker:', e); });
      issueDataService.invalidateTracker('linear').catch((e: Error) => { console.error('Failed to invalidate linear tracker:', e); });
    }

    return jsonResponse({ results });
  });
}
