/**
 * close-issue — Transition issue to closed/done state + label management.
 *
 * Uses the IssueTracker abstraction when available, with fallback to
 * direct API calls for contexts where the tracker isn't set up (e.g.,
 * standalone CLI).
 *
 * Operations:
 *   1. Transition issue to closed state
 *   2. Add 'closed-out' label
 *   3. Remove workflow labels (in-progress, in-review, needs-close-out)
 *   4. Add completion comment
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import type { IssueTracker } from '../tracker/interface.js';
import type { LifecycleContext, StepResult } from './types.js';
import { stepOk, stepSkipped, stepFailed, getLinearApiKey } from './types.js';
import { extractNumberSync, extractPrefixSync, normalizeIssueIdSync } from '../issue-id.js';
import { getAgentState, markAgentStoppedState, saveAgentState } from '../agents.js';

const execAsync = promisify(exec);

const CLOSED_OUT_LABEL = 'closed-out';
const CLOSED_OUT_COLOR = '1d4ed8';
const WORKFLOW_LABELS = ['in-progress', 'in-review', 'needs-close-out', 'verifying-on-main'];

/** Options for close-issue */
export interface CloseIssueOptions {
  /** IssueTracker instance (preferred — uses abstraction layer) */
  tracker?: IssueTracker;
  /** Reason for closing */
  reason?: string;
  /** Comment to add when closing */
  comment?: string;
  /** Apply the closed-out label. Default: true */
  applyLabel?: boolean;
  /** Only apply label (skip state transition). Default: false */
  labelOnly?: boolean;
}

/**
 * Close an issue and manage labels.
 *
 * If a tracker is provided, uses the abstraction layer.
 * Otherwise, falls back to direct gh CLI (GitHub) or Linear SDK calls.
 */
async function markWorkAgentStoppedForIssue(issueId: string): Promise<void> {
  const agentId = `agent-${normalizeIssueIdSync(issueId)}`;
  const state = await Effect.runPromise(getAgentState(agentId));
  if (!state) return;
  markAgentStoppedState(state);
  await Effect.runPromise(saveAgentState(state));
}

export function closeIssue(
  ctx: LifecycleContext,
  opts: CloseIssueOptions = {},
): Effect.Effect<StepResult[]> {
  return Effect.gen(function* () {
    const results: StepResult[] = [];
    const { applyLabel = true, labelOnly = false, comment } = opts;

    // Step 1: Transition to closed (unless labelOnly)
    if (!labelOnly) {
      const closeResult = opts.tracker
        ? yield* closeViaTracker(ctx, opts.tracker, comment)
        : yield* closeViaDirect(ctx, comment);
      results.push(closeResult);

      // If close failed, don't bother with labels
      if (!closeResult.success && !closeResult.skipped) {
        return results;
      }
    }

    // Step 2: Close any open PR for the feature branch (GitHub only)
    if (ctx.github) {
      const prResult = yield* closeGitHubPr(ctx);
      results.push(prResult);
    }

    // Step 3: Apply closed-out label + remove workflow labels
    if (applyLabel) {
      const labelResult = yield* applyClosedOutLabel(ctx, opts.tracker);
      results.push(labelResult);
    }

    return results;
  });
}

/**
 * Close via IssueTracker abstraction.
 */
function closeViaTracker(
  ctx: LifecycleContext,
  tracker: IssueTracker,
  comment?: string,
): Effect.Effect<StepResult> {
  const step = 'close-issue:transition';
  return Effect.gen(function* () {
    yield* tracker.transitionIssue(ctx.issueId, 'closed');
    yield* Effect.promise(() => markWorkAgentStoppedForIssue(ctx.issueId));
    if (comment) {
      // Best-effort comment — swallow errors
      yield* tracker.addComment(ctx.issueId, comment).pipe(
        Effect.catch(() => Effect.void),
      );
    }
    return stepOk(step, [`Closed ${ctx.issueId} via ${tracker.name} tracker`]);
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed(step, `Failed to close via tracker: ${(err as Error).message ?? String(err)}`)),
    ),
  );
}

/**
 * Close via direct API calls (fallback when no tracker configured).
 * Determines issue type from context and uses appropriate method.
 */
function closeViaDirect(
  ctx: LifecycleContext,
  comment?: string,
): Effect.Effect<StepResult> {
  const step = 'close-issue:transition';

  if (ctx.github) {
    return closeGitHubDirect(ctx, comment);
  }

  // Rally issue
  if (ctx.rally) {
    return closeRallyDirect(ctx);
  }

  // Try Linear
  return Effect.gen(function* () {
    const linearApiKey = yield* Effect.promise(() => getLinearApiKey());
    if (linearApiKey) {
      return yield* closeLinearDirect(ctx, linearApiKey);
    }
    return stepFailed(step, 'No tracker available and cannot determine issue type');
  });
}

/**
 * Close a GitHub issue via gh CLI.
 */
function closeGitHubDirect(ctx: LifecycleContext, comment?: string): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => closeGitHubDirectImpl(ctx, comment),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('close-issue:transition', `gh issue close failed: ${(err as Error).message}`)),
    ),
  );
}

async function closeGitHubDirectImpl(ctx: LifecycleContext, comment?: string): Promise<StepResult> {
  const step = 'close-issue:transition';
  if (!ctx.github) {
    return stepFailed(step, 'GitHub config not provided');
  }
  const { owner, repo, number } = ctx.github;

  // Refuse to close a GitHub issue when its feature branch still has an open,
  // unmerged PR. PAN-1030 closed the issue while PR #1046 was open with 1152
  // lines of real changes — the close-out path trusted the operator without
  // verifying the merge. Fail loudly so the operator notices and either
  // merges the PR first or tells us why the issue should still close.
  const branchName = `feature/${ctx.issueId.toLowerCase()}`;
  try {
    const { stdout: prRaw } = await execAsync(
      `gh pr list --repo ${owner}/${repo} --head "${branchName}" --state open --json number,mergedAt,mergeCommit --jq '.[0]'`,
      { encoding: 'utf-8' },
    );
    const trimmed = prRaw.trim();
    if (trimmed) {
      try {
        const pr = JSON.parse(trimmed) as { number?: number; mergedAt?: string | null; mergeCommit?: unknown };
        if (pr.number && !pr.mergedAt && !pr.mergeCommit) {
          return stepFailed(
            step,
            `Refusing to close issue #${number}: open PR #${pr.number} on ${branchName} has not been merged. Merge or close the PR first, or rename the branch if it is unrelated.`,
          );
        }
      } catch {
        // PR JSON unparseable — continue with the close (don't block on parser error).
      }
    }
  } catch {
    // gh query failed — don't block close-out on a flaky network call.
  }

  try {
    const commentArg = comment ? ` --comment "${comment.replace(/"/g, '\\"')}"` : '';
    await execAsync(
      `gh issue close ${number} --repo ${owner}/${repo}${commentArg}`,
      { encoding: 'utf-8' },
    );
    await markWorkAgentStoppedForIssue(ctx.issueId);
    return stepOk(step, [`Closed GitHub issue #${number} on ${owner}/${repo}`]);
  } catch (err) {
    return stepFailed(step, `gh issue close failed: ${(err as Error).message}`);
  }
}

/**
 * Close any open GitHub PR for the feature branch.
 */
function closeGitHubPr(ctx: LifecycleContext): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => closeGitHubPrImpl(ctx),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepSkipped('close-issue:close-pr', [`PR close failed (non-fatal): ${(err as Error).message}`])),
    ),
  );
}

async function closeGitHubPrImpl(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'close-issue:close-pr';
  if (!ctx.github) {
    return stepSkipped(step, ['Not a GitHub issue']);
  }
  const { owner, repo } = ctx.github;
  const issueLower = ctx.issueId.toLowerCase();
  const branchName = `feature/${issueLower}`;

  try {
    // Pull number + merge status. Closing without checking can land us in the
    // PAN-1030 state: issue closed + PR left OPEN with real unmerged code,
    // or worse — close a not-yet-merged PR with a "Merged via Panopticon
    // lifecycle" comment that lies about what happened.
    const { stdout: prListRaw } = await execAsync(
      `gh pr list --repo ${owner}/${repo} --head "${branchName}" --state open --json number,mergedAt,mergeCommit --jq '.[0]'`,
      { encoding: 'utf-8' },
    );
    const prRaw = prListRaw.trim();
    if (!prRaw) {
      return stepSkipped(step, ['No open PR found for branch']);
    }
    let pr: { number?: number; mergedAt?: string | null; mergeCommit?: unknown };
    try {
      pr = JSON.parse(prRaw);
    } catch {
      return stepSkipped(step, [`PR JSON parse failed: ${prRaw.slice(0, 80)}`]);
    }
    if (!pr.number) {
      return stepSkipped(step, ['Open PR query returned no number']);
    }
    if (!pr.mergedAt && !pr.mergeCommit) {
      // PR is open but NOT merged — refuse to close. The close-out flow must
      // not pretend an unmerged PR was merged. Fail loudly so the operator
      // notices the inconsistency rather than the PR silently disappearing.
      return stepFailed(
        step,
        `Refusing to close PR #${pr.number} on ${owner}/${repo}: PR is not merged. Investigate why close-out fired without a merge.`,
      );
    }
    await execAsync(
      `gh pr close ${pr.number} --repo ${owner}/${repo} --comment "Merged via Panopticon lifecycle"`,
      { encoding: 'utf-8' },
    );
    return stepOk(step, [`Closed PR #${pr.number} on ${owner}/${repo}`]);
  } catch (err) {
    return stepSkipped(step, [`PR close failed (non-fatal): ${(err as Error).message}`]);
  }
}

/**
 * Rate limit circuit breaker for Linear API.
 * After hitting a rate limit, stop all Linear API calls for COOLDOWN_MS.
 * This prevents the 24,626-call storm that exhausted Linear's 5000 req/hr limit (PAN-328).
 */
let _linearRateLimitUntil = 0;
const LINEAR_RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour (matches Linear's 5000/hr window)

/**
 * Close a Linear issue via SDK (find by identifier, transition to Done).
 */
function closeLinearDirect(ctx: LifecycleContext, apiKey: string): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => closeLinearDirectImpl(ctx, apiKey),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('close-issue:transition', `Linear close failed: ${(err as Error).message}`)),
    ),
  );
}

async function closeLinearDirectImpl(ctx: LifecycleContext, apiKey: string): Promise<StepResult> {
  const step = 'close-issue:transition';

  // Circuit breaker: if we recently hit a rate limit, fail fast without making API calls
  if (Date.now() < _linearRateLimitUntil) {
    const remainingMin = Math.ceil((_linearRateLimitUntil - Date.now()) / 60000);
    return stepFailed(step, `Linear rate limit cooldown active (${remainingMin}min remaining). Issue will be closed during close-out ceremony.`);
  }

  try {
    const { LinearClient } = await import('@linear/sdk');
    const client = new LinearClient({ apiKey });

    const issueNumber = extractNumberSync(ctx.issueId);
    const issuePrefix = extractPrefixSync(ctx.issueId);
    if (issueNumber === null || issuePrefix === null) {
      return stepFailed(step, `Could not parse issue ID: ${ctx.issueId}`);
    }
    const results = await client.issues({
      filter: {
        number: { eq: issueNumber },
        team: { key: { eq: issuePrefix } },
      },
      first: 1,
    });

    if (results.nodes.length === 0) {
      return stepFailed(step, `Issue ${ctx.issueId} not found in Linear`);
    }

    const issue = results.nodes[0];
    const team = await issue.team;
    if (team) {
      const states = await team.states();
      const doneState = states.nodes.find(s => s.name === 'Done') ||
        states.nodes.find(s => s.type === 'completed');
      if (doneState) {
        await issue.update({ stateId: doneState.id });
      }
    }

    await markWorkAgentStoppedForIssue(ctx.issueId);
    return stepOk(step, [`Moved Linear issue ${ctx.issueId} to Done`]);
  } catch (err) {
    const message = (err as Error).message;

    // Detect rate limit errors and activate circuit breaker
    if (message.includes('Rate limit') || message.includes('rate limit') || message.includes('429')) {
      _linearRateLimitUntil = Date.now() + LINEAR_RATE_LIMIT_COOLDOWN_MS;
      console.warn(`[close-issue] Linear rate limit hit — circuit breaker activated for 1 hour`);
      return stepFailed(step, `Linear rate limit exceeded. Circuit breaker activated — no Linear API calls for 1 hour. Issue will be closed during close-out ceremony.`);
    }

    return stepFailed(step, `Linear close failed: ${message}`);
  }
}

/**
 * Close a Rally issue via RallyTracker.
 */
function closeRallyDirect(ctx: LifecycleContext): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => closeRallyDirectImpl(ctx),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('close-issue:transition', `Rally close failed: ${(err as Error).message ?? String(err)}`)),
    ),
  );
}

async function closeRallyDirectImpl(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'close-issue:transition';
  if (!ctx.rally) {
    return stepFailed(step, 'Rally config not provided');
  }
  const { RallyTracker } = await import('../tracker/rally.js');
  const tracker = new RallyTracker({
    apiKey: ctx.rally.apiKey,
    server: ctx.rally.server,
    workspace: ctx.rally.workspace,
    project: ctx.rally.project,
  });
  // RallyTracker.transitionIssue returns Effect (migrated in PAN-1249).
  await Effect.runPromise(tracker.transitionIssue(ctx.issueId, 'closed'));
  await markWorkAgentStoppedForIssue(ctx.issueId);
  return stepOk(step, [`Closed Rally issue ${ctx.issueId}`]);
}

/**
 * Apply 'closed-out' label and remove workflow labels.
 * Uses tracker if available, falls back to direct calls.
 */
function applyClosedOutLabel(
  ctx: LifecycleContext,
  tracker?: IssueTracker,
): Effect.Effect<StepResult> {
  const step = 'close-issue:label';

  if (tracker) {
    return applyLabelViaTracker(ctx, tracker);
  }

  if (ctx.github) {
    return applyLabelGitHub(ctx);
  }

  return Effect.gen(function* () {
    const linearApiKey = yield* Effect.promise(() => getLinearApiKey());
    if (linearApiKey) {
      return yield* applyLabelLinear(ctx, linearApiKey);
    }
    return stepSkipped(step, ['No tracker available for label management']);
  });
}

function applyLabelViaTracker(
  ctx: LifecycleContext,
  tracker: IssueTracker,
): Effect.Effect<StepResult> {
  const step = 'close-issue:label';
  return Effect.gen(function* () {
    const issue = yield* tracker.getIssue(ctx.issueId);
    const newLabels = issue.labels.filter((l: string) => !WORKFLOW_LABELS.includes(l));
    if (!newLabels.includes(CLOSED_OUT_LABEL)) {
      newLabels.push(CLOSED_OUT_LABEL);
    }
    yield* tracker.updateIssue(ctx.issueId, { labels: newLabels });
    return stepOk(step, [`Applied '${CLOSED_OUT_LABEL}' label via ${tracker.name} tracker`]);
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepSkipped(step, [`Label management failed (non-fatal): ${(err as Error).message ?? String(err)}`])),
    ),
  );
}

function applyLabelGitHub(ctx: LifecycleContext): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => applyLabelGitHubImpl(ctx),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepSkipped('close-issue:label', [`Label management failed (non-fatal): ${(err as Error).message}`])),
    ),
  );
}

async function applyLabelGitHubImpl(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'close-issue:label';
  if (!ctx.github) return stepSkipped(step);
  const { owner, repo, number } = ctx.github;

  try {
    // Ensure label exists
    await execAsync(
      `gh label create "${CLOSED_OUT_LABEL}" --repo ${owner}/${repo} --color "${CLOSED_OUT_COLOR}" --description "Verified and closed out" --force 2>/dev/null || true`,
      { encoding: 'utf-8' },
    );
    const removeLabelArgs = WORKFLOW_LABELS
      .map(label => `--remove-label "${label}"`)
      .join(' ');
    await execAsync(
      `gh issue edit ${number} --repo ${owner}/${repo} --add-label "${CLOSED_OUT_LABEL}" ${removeLabelArgs}`,
      { encoding: 'utf-8' },
    );
    return stepOk(step, [`Applied '${CLOSED_OUT_LABEL}' label on GitHub`]);
  } catch (err) {
    return stepSkipped(step, [`Label management failed (non-fatal): ${(err as Error).message}`]);
  }
}

function applyLabelLinear(ctx: LifecycleContext, apiKey: string): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => applyLabelLinearImpl(ctx, apiKey),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepSkipped('close-issue:label', [`Linear label management failed (non-fatal): ${(err as Error).message}`])),
    ),
  );
}

async function applyLabelLinearImpl(ctx: LifecycleContext, apiKey: string): Promise<StepResult> {
  const step = 'close-issue:label';
  try {
    const { LinearClient } = await import('@linear/sdk');
    const client = new LinearClient({ apiKey });

    const issueNum = extractNumberSync(ctx.issueId);
    const teamKey = extractPrefixSync(ctx.issueId);
    if (issueNum === null || teamKey === null) {
      return stepFailed(step, `Could not parse issue ID: ${ctx.issueId}`);
    }
    const results = await client.issues({
      filter: {
        number: { eq: issueNum },
        team: { key: { eq: teamKey } },
      },
      first: 1,
    });
    if (results.nodes.length === 0) {
      return stepSkipped(step, ['Issue not found for label management']);
    }

    const issue = results.nodes[0];

    // Find or create closed-out label
    const labels = await client.issueLabels({ filter: { name: { eq: CLOSED_OUT_LABEL } } });
    let labelId: string;
    if (labels.nodes.length > 0) {
      labelId = labels.nodes[0].id;
    } else {
      const created = await client.createIssueLabel({ name: CLOSED_OUT_LABEL, color: `#${CLOSED_OUT_COLOR}` });
      const createdLabel = await created.issueLabel;
      labelId = createdLabel ? createdLabel.id : '';
    }

    if (labelId) {
      const existingLabels = await issue.labels();
      const labelIds = existingLabels.nodes.map(l => l.id);
      if (!labelIds.includes(labelId)) {
        labelIds.push(labelId);
        await issue.update({ labelIds });
      }
    }

    return stepOk(step, [`Applied '${CLOSED_OUT_LABEL}' label on Linear`]);
  } catch (err) {
    return stepSkipped(step, [`Linear label management failed (non-fatal): ${(err as Error).message}`]);
  }
}
