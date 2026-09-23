/**
 * GitHub webhook event handlers (PAN-905).
 *
 * PAN-3917: the handlers used to mirror GitHub's own merge blockers into a
 * `review_status` row. GitHub already owns that state and `cloister/pr-facts`
 * reads it on demand, so nothing is written back here any more. What is left is
 * the work a webhook can do that a read cannot: invalidate the PR-tab cache,
 * record a default-branch CI suite observation, relay a CI failure to the work
 * agent, start the review pipeline for a PR opened or readied outside
 * `pan done`, and fire the post-merge lifecycle for merges that bypassed
 * Overdeck.
 * Shared advisory-check classification keeps CodeRabbit out of merge gates.
 */

import { Effect } from 'effect';
import { getGitHubConfig } from '../dashboard/server/services/tracker-config.js';
import { GitHubApiError } from './errors.js';
import { recordCiTestGatePass, relayCiFailureFeedback } from './cloister/ci-failure-feedback.js';
import { isCiTestCheckName } from './cloister/verification-tests-mode.js';
import { getPrFacts } from './cloister/pr-facts.js';
import { bumpIssuePrTabCacheGeneration } from '../dashboard/server/services/pr-tab-cache.js';
import { ADVISORY_CHECK_NAMES, isAdvisoryCheckName } from './advisory-checks.js';
import { appendDomainEventAsync } from './activity-logger.js';
import {
  observationFromCheckSuite,
  resolveProjectForRepo,
} from './ci/project-ci-observation.js';
import { resolveDefaultBranchHead } from './ci/project-ci-github.js';

export { ADVISORY_CHECK_NAMES, isAdvisoryCheckName };

export interface WebhookPayload {
  action?: string;
  pull_request?: {
    number: number;
    head: { ref: string; sha?: string };
    html_url?: string;
    mergeable?: boolean | null;
    mergeable_state?: string;
    draft?: boolean;
    state?: string;
    merged?: boolean;
  };
  check_suite?: {
    id?: number;
    status?: string;
    conclusion?: string | null;
    head_branch?: string;
    head_sha?: string;
    updated_at?: string;
    app?: { slug?: string };
    pull_requests?: Array<{ number: number; head: { ref: string; sha?: string } }>;
  };
  check_run?: {
    id?: number;
    name?: string;
    status?: string;
    conclusion?: string | null;
    pull_requests?: Array<{ number: number; head: { ref: string; sha?: string } }>;
  };
  repository?: { full_name: string };
  issue?: {
    number?: number;
    pull_request?: unknown;
  };
  review?: { state: string };
  thread?: { id?: number; resolved?: boolean };
  // status event payload
  sha?: string;
  state?: string;
  context?: string;
  branches?: Array<{ name: string }>;
}

/** The canonical PR URL for a repo/number pair, for feedback copy. */
function prUrlFor(repo: string, prNumber: number): string {
  return `https://github.com/${repo}/pull/${prNumber}`;
}

/**
 * Resolve the issue a PR belongs to from its head branch, asking the forge.
 * PAN-3917: the branch name is the only issue binding Overdeck keeps.
 */
async function issueIdForPrNumber(repo: string, prNumber: number): Promise<string | null> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'view', String(prNumber), '--repo', repo, '--json', 'headRefName'],
      { encoding: 'utf-8', timeout: 15000 },
    );
    const parsed = JSON.parse(stdout) as { headRefName?: string };
    return parsed.headRefName ? issueIdFromBranch(parsed.headRefName) : null;
  } catch {
    return null;
  }
}

export function issueIdFromBranch(ref: string): string | null {
  const match = ref.match(/(?:feature|strike|bypass)\/([a-z]+-\d+)$/i);
  return match ? match[1].toUpperCase() : null;
}

// ─── Repository authorization (defense-in-depth) ─────────────────────────────

// ─── Cached repository allowlist (refreshed every 5 min) ─────────────────────

let cachedTrackedRepos: Set<string> | null = null;
let cachedTrackedReposAt = 0;
const REPO_CACHE_TTL_MS = 5 * 60 * 1000;

function getTrackedRepos(): Set<string> {
  const now = Date.now();
  if (!cachedTrackedRepos || now - cachedTrackedReposAt > REPO_CACHE_TTL_MS) {
    const config = getGitHubConfig();
    cachedTrackedRepos = config
      ? new Set(config.repos.map(({ owner, repo }) => `${owner}/${repo}`.toLowerCase()))
      : new Set();
    cachedTrackedReposAt = now;
  }
  return cachedTrackedRepos;
}

export function isTrackedRepositorySync(fullName: string | undefined): boolean {
  if (!fullName) return false;
  return getTrackedRepos().has(fullName.toLowerCase());
}

/** `gh` statusCheckRollup conclusions/states that count as a failing required check. */
export const FAILING_CHECK_CONCLUSIONS = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']);

async function handleCheckSuitePromise(payload: WebhookPayload): Promise<void> {
  // PAN-3537: a push to the default branch produces a check suite with an empty
  // pull_requests array. Record it for the Command Deck CI chip, then fall
  // through to the existing PR-scoped merge-gate logic.
  const project = resolveProjectForRepo(payload.repository?.full_name);
  const projectSuite = payload.check_suite;
  if (
    project
    && projectSuite?.app?.slug === 'github-actions'
    && projectSuite.head_branch === project.branch
    && projectSuite.head_sha
    && projectSuite.id != null
  ) {
    try {
      const authoritativeHead = await resolveDefaultBranchHead(
        project.repo,
        project.branch,
      );
      const observation = observationFromCheckSuite(
        payload,
        new Date().toISOString(),
        undefined,
        authoritativeHead,
      );
      if (observation) {
        await appendDomainEventAsync({
          type: 'project.ci_suite_observed',
          timestamp: observation.observedAt,
          payload: observation,
        });
      }
    } catch (error) {
      console.warn('[webhook] Could not verify project CI branch head:', error);
    }
  }

  if (!isTrackedRepositorySync(payload.repository?.full_name)) return;
  const suite = payload.check_suite;
  if (!suite) return;
  if (!suite.pull_requests || suite.pull_requests.length === 0) return;

  const repo = payload.repository!.full_name;

  for (const pr of suite.pull_requests) {
    const issueId = issueIdFromBranch(pr.head.ref);
    if (!issueId) continue;

    bumpIssuePrTabCacheGeneration(issueId);

    if (suite.conclusion && FAILING_CHECK_CONCLUSIONS.has(suite.conclusion.toUpperCase())) {
      if (pr.head.sha && pr.number != null) {
        await Effect.runPromise(relayCiFailureFeedback({
          issueId,
          repo,
          prNumber: pr.number,
          headSha: pr.head.sha,
          headRef: pr.head.ref,
          prUrl: prUrlFor(repo, pr.number),
          source: 'check_suite',
        }));
      }
    }
  }
}

async function handleCheckRunPromise(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepositorySync(payload.repository?.full_name)) return;
  const run = payload.check_run;
  if (!run) return;
  if (!run.pull_requests || run.pull_requests.length === 0) return;

  const repo = payload.repository!.full_name;
  const sourceKey = `check_run:${run.name ?? String(run.id ?? 'unknown')}`;
  const isAdvisory = isAdvisoryCheckName(run.name);

  for (const pr of run.pull_requests) {
    const issueId = issueIdFromBranch(pr.head.ref);
    if (!issueId) continue;

    bumpIssuePrTabCacheGeneration(issueId);
    if (isAdvisory) continue;

    if (run.conclusion && FAILING_CHECK_CONCLUSIONS.has(run.conclusion.toUpperCase())) {
      if (pr.head.sha && pr.number != null) {
        await Effect.runPromise(relayCiFailureFeedback({
          issueId,
          repo,
          prNumber: pr.number,
          headSha: pr.head.sha,
          headRef: pr.head.ref,
          prUrl: prUrlFor(repo, pr.number),
          source: sourceKey,
        }));
      }
    } else if (run.conclusion?.toUpperCase() === 'SUCCESS' && isCiTestCheckName(run.name) && pr.head.sha) {
      // PAN-3965: a green CI test job resets the verification attempt count
      // for a `verification.tests: ci` project (a no-op for any other project,
      // and for a strike or bypass PR, whose head is not the feature branch).
      await Effect.runPromise(recordCiTestGatePass({ issueId, headSha: pr.head.sha, headRef: pr.head.ref, source: sourceKey }));
    }
  }
}

async function handlePullRequestPromise(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepositorySync(payload.repository?.full_name)) return;
  const pr = payload.pull_request;
  if (!pr) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;
  bumpIssuePrTabCacheGeneration(issueId);

  const repo = payload.repository!.full_name;

  if (['opened', 'closed', 'reopened'].includes(payload.action ?? '')) {
    try {
      const { listProjectsSync, resolveProjectFromIssueSync } = await import('./projects.js');
      const resolved = resolveProjectFromIssueSync(issueId);
      const project = resolved
        ? listProjectsSync().find((entry) => entry.key === resolved.projectKey)?.config
        : undefined;
      if (project) {
        const { enqueueProjectResourceRefresh } = await import(
          '../dashboard/server/services/project-resource-refresh-queue.js'
        );
        enqueueProjectResourceRefresh(project, `pull_request:${payload.action}`);
      }
    } catch (err: any) {
      console.warn(`[webhook] Failed to enqueue membership refresh for ${issueId}: ${err?.message ?? err}`);
    }
  }

  // PAN-3917 (W12): a pull request that is open and not a draft IS the review
  // request. `pan done` asks the dashboard directly, but a PR opened or readied
  // by hand never called it, so the convoy never started. Start the same
  // pipeline here; `requestReviewPipeline.isInFlight` coalesces the two callers
  // and the whole path is best-effort — a webhook must never throw.
  // The pipeline verifies, pushes and reviews `feature/<issue>` — the branch the
  // workspace is on. A strike or bypass PR names the same issue but a different
  // branch, so starting here would review something the PR does not contain.
  if (
    (payload.action === 'opened' || payload.action === 'ready_for_review')
    && pr.draft !== true
    && pr.merged !== true
    && (pr.state ?? 'open') !== 'closed'
    && pr.head.ref.toLowerCase().startsWith('feature/')
  ) {
    try {
      const { getRequestReviewStarter } = await import('./cloister/request-review-pipeline.js');
      const startReview = getRequestReviewStarter();
      if (!startReview) {
        console.warn(`[webhook] No review starter registered — not starting review for ${issueId}`);
      } else {
        const outcome = await startReview(issueId, {
          note: `PR ${payload.action} on ${repo}#${pr.number} — starting verification`,
          source: 'webhook',
        });
        if (!outcome.started) {
          console.log(`[webhook] Review not started for ${issueId}: ${outcome.reason}`);
        }
      }
    } catch (err: any) {
      console.warn(`[webhook] Failed to start the review pipeline for ${issueId}: ${err?.message ?? err}`);
    }
  }

  // PAN-1513: fire postMergeLifecycle when GitHub reports the PR closed+merged.
  // Without this, admin-merges (gh pr merge --admin) and any merge that doesn't
  // route through Overdeck's own merge flow leave work agents, strikes, tmux
  // sessions, and worktrees orphaned. postMergeLifecycle has its own
  // single-flight guard (specialists.ts L116) and _completedPostMerge marker,
  // so duplicate webhook deliveries are idempotent.
  if (payload.action === 'closed' && pr.merged === true) {
    try {
      const { postMergeLifecycle } = await import('./cloister/merge-agent.js');
      const { resolveProjectFromIssueSync } = await import('./projects.js');
      const project = resolveProjectFromIssueSync(issueId);
      if (project) {
        const branchName = pr.head.ref;
        postMergeLifecycle(issueId, project.projectPath, branchName).catch(err =>
          console.warn(`[webhook] postMergeLifecycle failed for ${issueId} (${branchName}): ${err?.message ?? err}`),
        );
      }
    } catch (err: any) {
      console.warn(`[webhook] Failed to dispatch postMergeLifecycle for ${issueId}: ${err?.message ?? err}`);
    }
  }

}

async function handlePullRequestReviewPromise(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepositorySync(payload.repository?.full_name)) return;
  const pr = payload.pull_request;
  const review = payload.review;
  if (!pr || !review) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;
  bumpIssuePrTabCacheGeneration(issueId);

}

async function handlePullRequestReviewCommentPromise(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepositorySync(payload.repository?.full_name)) return;
  const pr = payload.pull_request;
  if (!pr) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;
  bumpIssuePrTabCacheGeneration(issueId);
}

async function handleIssueCommentPromise(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepositorySync(payload.repository?.full_name)) return;
  const issue = payload.issue;
  if (!issue?.pull_request || issue.number == null) return;

  // PAN-3917: mapping a PR number back to an issue id used to be a scan of the
  // review_status rows. The branch name is the only issue binding Overdeck
  // keeps, and an issue_comment payload does not carry one, so ask the forge.
  const repo = payload.repository!.full_name;
  const issueId = await issueIdForPrNumber(repo, issue.number);
  if (issueId) bumpIssuePrTabCacheGeneration(issueId);
}

async function handlePullRequestReviewThreadPromise(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepositorySync(payload.repository?.full_name)) return;
  const pr = payload.pull_request;
  if (!pr || !payload.thread) return;
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) return;
  bumpIssuePrTabCacheGeneration(issueId);
}

async function handleStatusPromise(payload: WebhookPayload): Promise<void> {
  if (!isTrackedRepositorySync(payload.repository?.full_name)) return;
  const state = payload.state;
  const branches = payload.branches;
  if (!state || !branches || branches.length === 0) return;

  const repo = payload.repository!.full_name;
  const context = payload.context ?? 'default';
  const sourceKey = `status:${context}`;
  if (isAdvisoryCheckName(context)) {
    for (const branch of branches) {
      const issueId = issueIdFromBranch(branch.name);
      if (issueId) bumpIssuePrTabCacheGeneration(issueId);
    }
    return;
  }

  for (const branch of branches) {
    const issueId = issueIdFromBranch(branch.name);
    if (!issueId) continue;
    bumpIssuePrTabCacheGeneration(issueId);
    if (state !== 'failure' && state !== 'error') continue;
    if (!payload.sha) continue;

    // A commit status carries no PR identity. The forge does.
    const facts = await getPrFacts(issueId);
    if (!facts.open || facts.number == null || !facts.url) continue;
    await Effect.runPromise(relayCiFailureFeedback({
      issueId,
      repo,
      prNumber: facts.number,
      headSha: payload.sha,
      headRef: branch.name,
      prUrl: facts.url,
      source: sourceKey,
    }));
  }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

const toGhError = (op: string, cause: unknown): GitHubApiError =>
  new GitHubApiError({
    operation: op,
    status: 0,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/** Effect: handle a `check_suite` GitHub webhook payload. */
export const handleCheckSuite = (
  payload: WebhookPayload,
): Effect.Effect<void, GitHubApiError> =>
  Effect.tryPromise({
    try: () => handleCheckSuitePromise(payload),
    catch: (cause) => toGhError('handleCheckSuite', cause),
  });

/** Effect: handle a `check_run` GitHub webhook payload. */
export const handleCheckRun = (
  payload: WebhookPayload,
): Effect.Effect<void, GitHubApiError> =>
  Effect.tryPromise({
    try: () => handleCheckRunPromise(payload),
    catch: (cause) => toGhError('handleCheckRun', cause),
  });

/** Effect: handle a `pull_request` GitHub webhook payload. */
export const handlePullRequest = (
  payload: WebhookPayload,
): Effect.Effect<void, GitHubApiError> =>
  Effect.tryPromise({
    try: () => handlePullRequestPromise(payload),
    catch: (cause) => toGhError('handlePullRequest', cause),
  });

/** Effect: handle a `pull_request_review` GitHub webhook payload. */
export const handlePullRequestReview = (
  payload: WebhookPayload,
): Effect.Effect<void, GitHubApiError> =>
  Effect.tryPromise({
    try: () => handlePullRequestReviewPromise(payload),
    catch: (cause) => toGhError('handlePullRequestReview', cause),
  });

/** Effect: handle a `pull_request_review_comment` GitHub webhook payload. */
export const handlePullRequestReviewComment = (
  payload: WebhookPayload,
): Effect.Effect<void, GitHubApiError> =>
  Effect.tryPromise({
    try: () => handlePullRequestReviewCommentPromise(payload),
    catch: (cause) => toGhError('handlePullRequestReviewComment', cause),
  });

/** Effect: handle an `issue_comment` GitHub webhook payload for PR tab cache invalidation. */
export const handleIssueComment = (
  payload: WebhookPayload,
): Effect.Effect<void, GitHubApiError> =>
  Effect.tryPromise({
    try: () => handleIssueCommentPromise(payload),
    catch: (cause) => toGhError('handleIssueComment', cause),
  });

/** Effect: handle a `pull_request_review_thread` GitHub webhook payload. */
export const handlePullRequestReviewThread = (
  payload: WebhookPayload,
): Effect.Effect<void, GitHubApiError> =>
  Effect.tryPromise({
    try: () => handlePullRequestReviewThreadPromise(payload),
    catch: (cause) => toGhError('handlePullRequestReviewThread', cause),
  });

/** Effect: handle a `status` GitHub webhook payload. */
export const handleStatus = (
  payload: WebhookPayload,
): Effect.Effect<void, GitHubApiError> =>
  Effect.tryPromise({
    try: () => handleStatusPromise(payload),
    catch: (cause) => toGhError('handleStatus', cause),
  });

/** True if the repo is in the cached tracked-repos allowlist. Pure. */
export const isTrackedRepository = (
  fullName: string | undefined,
): Effect.Effect<boolean> =>
  Effect.sync(() => isTrackedRepositorySync(fullName));
