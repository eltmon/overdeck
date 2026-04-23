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
import type { IssueTracker } from '../tracker/interface.js';
import type { LifecycleContext, StepResult } from './types.js';
import { stepOk, stepSkipped, stepFailed, getLinearApiKey } from './types.js';
import { extractNumber, extractPrefix } from '../issue-id.js';
import { setCanonicalState } from './reconciler/index.js';

const execAsync = promisify(exec);

const CLOSED_OUT_LABEL = 'closed-out';
const CLOSED_OUT_COLOR = '1d4ed8';
const WORKFLOW_LABELS = ['in-progress', 'in-review', 'needs-close-out'];

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
export async function closeIssue(
  ctx: LifecycleContext,
  opts: CloseIssueOptions = {},
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const { applyLabel = true, labelOnly = false, comment } = opts;

  // Step 1: Transition to closed (unless labelOnly)
  if (!labelOnly) {
    const closeResult = opts.tracker
      ? await closeViaTracker(ctx, opts.tracker, comment)
      : await closeViaDirect(ctx, comment);
    results.push(closeResult);

    // If close failed, don't bother with labels
    if (!closeResult.success && !closeResult.skipped) {
      return results;
    }
  }

  // Step 2: Close any open PR for the feature branch (GitHub only)
  if (ctx.github) {
    const prResult = await closeGitHubPr(ctx);
    results.push(prResult);
  }

  // Step 3: Apply closed-out label + remove workflow labels
  if (applyLabel) {
    const labelResult = await applyClosedOutLabel(ctx, opts.tracker);
    results.push(labelResult);
  }

  return results;
}

/**
 * Close via IssueTracker abstraction.
 */
async function closeViaTracker(
  ctx: LifecycleContext,
  tracker: IssueTracker,
  comment?: string,
): Promise<StepResult> {
  const step = 'close-issue:transition';
  try {
    await tracker.transitionIssue(ctx.issueId, 'closed');
    if (comment) {
      try {
        await tracker.addComment(ctx.issueId, comment);
      } catch {
        // Non-fatal — comment is best-effort
      }
    }
    return stepOk(step, [`Closed ${ctx.issueId} via ${tracker.name} tracker`]);
  } catch (err) {
    return stepFailed(step, `Failed to close via tracker: ${(err as Error).message}`);
  }
}

/**
 * Close via direct API calls (fallback when no tracker configured).
 * Determines issue type from context and uses appropriate method.
 */
async function closeViaDirect(
  ctx: LifecycleContext,
  comment?: string,
): Promise<StepResult> {
  const step = 'close-issue:transition';

  if (ctx.github) {
    return closeGitHubDirect(ctx, comment);
  }

  // Rally issue
  if (ctx.rally) {
    return closeRallyDirect(ctx);
  }

  // Try Linear
  const linearApiKey = getLinearApiKey();
  if (linearApiKey) {
    return closeLinearDirect(ctx, linearApiKey);
  }

  return stepFailed(step, 'No tracker available and cannot determine issue type');
}

/**
 * Close a GitHub issue via gh CLI.
 */
async function closeGitHubDirect(ctx: LifecycleContext, comment?: string): Promise<StepResult> {
  const step = 'close-issue:transition';
  if (!ctx.github) {
    return stepFailed(step, 'GitHub config not provided');
  }
  const { owner, repo, number } = ctx.github;
  try {
    const commentArg = comment ? ` --comment "${comment.replace(/"/g, '\\"')}"` : '';
    await execAsync(
      `gh issue close ${number} --repo ${owner}/${repo}${commentArg}`,
      { encoding: 'utf-8' },
    );
    return stepOk(step, [`Closed GitHub issue #${number} on ${owner}/${repo}`]);
  } catch (err) {
    return stepFailed(step, `gh issue close failed: ${(err as Error).message}`);
  }
}

/**
 * Close any open GitHub PR for the feature branch.
 */
async function closeGitHubPr(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'close-issue:close-pr';
  if (!ctx.github) {
    return stepSkipped(step, ['Not a GitHub issue']);
  }
  const { owner, repo } = ctx.github;
  const issueLower = ctx.issueId.toLowerCase();
  const branchName = `feature/${issueLower}`;

  try {
    const { stdout: prListRaw } = await execAsync(
      `gh pr list --repo ${owner}/${repo} --head "${branchName}" --state open --json number --jq '.[0].number'`,
      { encoding: 'utf-8' },
    );
    const prNumber = prListRaw.trim();
    if (!prNumber) {
      return stepSkipped(step, ['No open PR found for branch']);
    }
    await execAsync(
      `gh pr close ${prNumber} --repo ${owner}/${repo} --comment "Merged via Panopticon lifecycle"`,
      { encoding: 'utf-8' },
    );
    return stepOk(step, [`Closed PR #${prNumber} on ${owner}/${repo}`]);
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
async function closeLinearDirect(ctx: LifecycleContext, apiKey: string): Promise<StepResult> {
  const step = 'close-issue:transition';

  // Circuit breaker: if we recently hit a rate limit, fail fast without making API calls
  if (Date.now() < _linearRateLimitUntil) {
    const remainingMin = Math.ceil((_linearRateLimitUntil - Date.now()) / 60000);
    return stepFailed(step, `Linear rate limit cooldown active (${remainingMin}min remaining). Issue will be closed during close-out ceremony.`);
  }

  try {
    const { LinearClient } = await import('@linear/sdk');
    const client = new LinearClient({ apiKey });

    const issueNumber = extractNumber(ctx.issueId);
    const issuePrefix = extractPrefix(ctx.issueId);
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
async function closeRallyDirect(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'close-issue:transition';
  if (!ctx.rally) {
    return stepFailed(step, 'Rally config not provided');
  }
  try {
    const { RallyTracker } = await import('../tracker/rally.js');
    const tracker = new RallyTracker({
      apiKey: ctx.rally.apiKey,
      server: ctx.rally.server,
      workspace: ctx.rally.workspace,
      project: ctx.rally.project,
    });
    await tracker.transitionIssue(ctx.issueId, 'closed');
    return stepOk(step, [`Closed Rally issue ${ctx.issueId}`]);
  } catch (err) {
    return stepFailed(step, `Rally close failed: ${(err as Error).message}`);
  }
}

/**
 * Apply 'closed-out' label and remove workflow labels.
 * Uses tracker if available, falls back to direct calls.
 */
async function applyClosedOutLabel(
  ctx: LifecycleContext,
  tracker?: IssueTracker,
): Promise<StepResult> {
  const step = 'close-issue:label';

  if (tracker) {
    return applyLabelViaTracker(ctx, tracker);
  }

  if (ctx.github) {
    return applyLabelGitHub(ctx);
  }

  const linearApiKey = getLinearApiKey();
  if (linearApiKey) {
    return applyLabelLinear(ctx, linearApiKey);
  }

  return stepSkipped(step, ['No tracker available for label management']);
}

async function applyLabelViaTracker(
  ctx: LifecycleContext,
  tracker: IssueTracker,
): Promise<StepResult> {
  const step = 'close-issue:label';
  try {
    const issue = await tracker.getIssue(ctx.issueId);
    const newLabels = issue.labels.filter(l => !WORKFLOW_LABELS.includes(l));
    if (!newLabels.includes(CLOSED_OUT_LABEL)) {
      newLabels.push(CLOSED_OUT_LABEL);
    }
    await tracker.updateIssue(ctx.issueId, { labels: newLabels });
    return stepOk(step, [`Applied '${CLOSED_OUT_LABEL}' label via ${tracker.name} tracker`]);
  } catch (err) {
    // Label management is non-fatal
    return stepSkipped(step, [`Label management failed (non-fatal): ${(err as Error).message}`]);
  }
}

async function applyLabelGitHub(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'close-issue:label';
  if (!ctx.github) return stepSkipped(step);
  const { owner, repo, number } = ctx.github;

  try {
    // PAN-805: workflow labels are owned by the reconciler — enqueue state so it
    // computes deltas and removes in-progress/in-review/needs-close-out.
    setCanonicalState(ctx.issueId, 'merged');

    // Ensure label exists
    await execAsync(
      `gh label create "${CLOSED_OUT_LABEL}" --repo ${owner}/${repo} --color "${CLOSED_OUT_COLOR}" --description "Verified and closed out" --force 2>/dev/null || true`,
      { encoding: 'utf-8' },
    );
    // Add label (closed-out is a human-driven marker, not a workflow label)
    await execAsync(
      `gh issue edit ${number} --repo ${owner}/${repo} --add-label "${CLOSED_OUT_LABEL}"`,
      { encoding: 'utf-8' },
    );
    return stepOk(step, [`Applied '${CLOSED_OUT_LABEL}' label on GitHub`]);
  } catch (err) {
    return stepSkipped(step, [`Label management failed (non-fatal): ${(err as Error).message}`]);
  }
}

async function applyLabelLinear(ctx: LifecycleContext, apiKey: string): Promise<StepResult> {
  const step = 'close-issue:label';
  try {
    const { LinearClient } = await import('@linear/sdk');
    const client = new LinearClient({ apiKey });

    const issueNum = extractNumber(ctx.issueId);
    const teamKey = extractPrefix(ctx.issueId);
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

