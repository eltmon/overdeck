/**
 * label-cleanup — Remove workflow labels and apply 'merged' label after merge.
 *
 * Runs as part of postMergeLifecycle (step 3b), independently of close-issue.
 * Labels are cleaned even if the issue close step fails.
 *
 * Removes: in-review, in-progress, merge-agent
 * Adds:    merged
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { LifecycleContext, StepResult } from './types.js';
import { stepOk, stepSkipped, stepFailed, getLinearApiKey } from './types.js';
import { extractNumber, extractPrefix } from '../issue-id.js';
import { resolveGitHubIssue } from '../tracker-utils.js';
import { loadReviewStatuses } from '../review-status.js';

const execAsync = promisify(exec);

const MERGED_LABEL = 'merged';
const MERGED_COLOR = '0e8a16'; // green
const LABELS_TO_REMOVE = ['in-review', 'in-progress', 'merge-agent'];

/**
 * Remove workflow labels and apply 'merged' label.
 * Non-fatal: label management failure does not block the merge lifecycle.
 */
export async function cleanupMergedLabels(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'label-cleanup:merged';

  if (ctx.github) {
    return cleanupLabelsGitHub(ctx);
  }

  const linearApiKey = getLinearApiKey();
  if (linearApiKey) {
    return cleanupLabelsLinear(ctx, linearApiKey);
  }

  return stepSkipped(step, ['No tracker available for label cleanup']);
}

async function cleanupLabelsGitHub(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'label-cleanup:merged';
  if (!ctx.github) return stepSkipped(step);
  const { owner, repo, number } = ctx.github;

  try {
    // Ensure merged label exists
    await execAsync(
      `gh label create "${MERGED_LABEL}" --repo ${owner}/${repo} --color "${MERGED_COLOR}" --description "Merged to main" --force 2>/dev/null || true`,
      { encoding: 'utf-8' },
    );

    // Add merged label
    await execAsync(
      `gh issue edit ${number} --repo ${owner}/${repo} --add-label "${MERGED_LABEL}"`,
      { encoding: 'utf-8' },
    );

    // Remove workflow labels (best-effort — skip if not present)
    for (const label of LABELS_TO_REMOVE) {
      await execAsync(
        `gh issue edit ${number} --repo ${owner}/${repo} --remove-label "${label}" 2>/dev/null || true`,
        { encoding: 'utf-8' },
      );
    }

    return stepOk(step, [
      `Applied '${MERGED_LABEL}' label on GitHub #${number}`,
      `Removed: ${LABELS_TO_REMOVE.join(', ')}`,
    ]);
  } catch (err) {
    return stepFailed(step, `Label cleanup failed: ${(err as Error).message}`);
  }
}

/**
 * Startup repair: clean workflow labels for any GitHub issue that was merged
 * (mergeStatus === 'merged') but still has in-review/in-progress/merge-agent labels.
 *
 * Handles cases where cleanupMergedLabels() failed silently during postMergeLifecycle
 * (e.g., transient GitHub API error, label not yet created).
 *
 * Fire-and-forget — called at server startup, errors logged but non-fatal.
 */
export async function repairMergedLabels(): Promise<void> {
  try {
    const statuses = loadReviewStatuses();
    const merged = Object.values(statuses).filter(s => s.mergeStatus === 'merged');
    if (merged.length === 0) return;

    for (const s of merged) {
      const resolved = resolveGitHubIssue(s.issueId);
      if (!resolved.isGitHub) continue;
      try {
        const ctx: LifecycleContext = {
          issueId: s.issueId,
          projectPath: '',
          github: { owner: resolved.owner, repo: resolved.repo, number: resolved.number },
        };
        const result = await cleanupLabelsGitHub(ctx);
        if (result.success && !result.skipped) {
          console.log(`[label-cleanup] Repaired labels for merged ${s.issueId}`);
        }
      } catch {
        // non-fatal — best-effort repair
      }
    }
  } catch (err) {
    console.warn(`[label-cleanup] repairMergedLabels failed: ${err}`);
  }
}

/**
 * Startup repair: detect GitHub PRs that are already merged on GitHub but whose
 * internal review-status still shows mergeStatus != 'merged'.
 *
 * This handles the case where the post-merge verification fails AFTER gh pr merge
 * already executed — the PR is merged on GitHub but Panopticon marks it as failed.
 * On the next retry the merge agent would fail with "PR already merged", looping forever.
 *
 * Fix: detect these cases on startup, update internal state to merged, and trigger
 * postMergeLifecycle to complete cleanup (labels, issue close, beads, etc.).
 *
 * Fire-and-forget — non-fatal, errors are logged.
 */
export async function repairAlreadyMergedPRs(): Promise<void> {
  try {
    const { setReviewStatus } = await import('../review-status.js');
    const statuses = loadReviewStatuses();

    // Issues that aren't yet marked as merged but have a PR URL
    const candidates = Object.values(statuses).filter(
      s => s.mergeStatus !== 'merged' && s.prUrl,
    );
    if (candidates.length === 0) return;

    for (const s of candidates) {
      const resolved = resolveGitHubIssue(s.issueId);
      if (!resolved.isGitHub || !s.prUrl) continue;

      // Extract PR number from prUrl (e.g. https://github.com/owner/repo/pull/671 → 671)
      const prNumMatch = s.prUrl.match(/\/pull\/(\d+)$/);
      if (!prNumMatch) continue;
      const prNumber = prNumMatch[1];

      try {
        const { stdout } = await execAsync(
          `gh pr view ${prNumber} --repo ${resolved.owner}/${resolved.repo} --json state --jq .state`,
          { encoding: 'utf-8', timeout: 10000 },
        );
        if (stdout.trim() !== 'MERGED') continue;

        // PR is already merged on GitHub — update internal state
        console.log(`[label-cleanup] ${s.issueId} PR #${prNumber} already merged on GitHub — repairing internal state`);
        setReviewStatus(s.issueId, { mergeStatus: 'merged' });

        // Fire postMergeLifecycle to complete cleanup (labels, issue close, beads)
        const { postMergeLifecycle } = await import('../cloister/merge-agent.js');
        const { resolveProjectFromIssue } = await import('../projects.js');
        const project = resolveProjectFromIssue(s.issueId);
        const projectPath = project?.projectPath ?? '';
        const sourceBranch = `feature/${s.issueId.toLowerCase()}`;
        postMergeLifecycle(s.issueId, projectPath, sourceBranch).catch(err => {
          console.warn(`[label-cleanup] postMergeLifecycle repair failed for ${s.issueId}: ${err}`);
        });
      } catch {
        // non-fatal — best-effort
      }
    }
  } catch (err) {
    console.warn(`[label-cleanup] repairAlreadyMergedPRs failed: ${err}`);
  }
}

/**
 * Startup repair: fire postMergeLifecycle(skipDeploy) for GitHub issues that are marked
 * as merged internally but whose GitHub issue is still OPEN.
 *
 * Handles cases where postMergeLifecycle ran but the close-issue step failed silently
 * (e.g., transient GitHub API error, circuit-breaker trip, server crash mid-cleanup).
 *
 * Fire-and-forget — non-fatal, errors are logged.
 */
export async function repairIncompletePostMergeLifecycle(): Promise<void> {
  try {
    const statuses = loadReviewStatuses();

    // Issues already marked as merged internally
    const candidates = Object.values(statuses).filter(
      s => s.mergeStatus === 'merged' && s.prUrl,
    );
    if (candidates.length === 0) return;

    for (const s of candidates) {
      const resolved = resolveGitHubIssue(s.issueId);
      if (!resolved.isGitHub) continue;

      try {
        const { stdout } = await execAsync(
          `gh issue view ${resolved.number} --repo ${resolved.owner}/${resolved.repo} --json state --jq .state`,
          { encoding: 'utf-8', timeout: 10000 },
        );
        if (stdout.trim() !== 'OPEN') continue;

        // Issue is still open — re-run cleanup with skipDeploy to avoid rebuilding
        console.log(`[label-cleanup] ${s.issueId} GitHub issue #${resolved.number} still open after merge — repairing`);
        const { postMergeLifecycle } = await import('../cloister/merge-agent.js');
        const { resolveProjectFromIssue } = await import('../projects.js');
        const project = resolveProjectFromIssue(s.issueId);
        const projectPath = project?.projectPath ?? '';
        const sourceBranch = `feature/${s.issueId.toLowerCase()}`;
        postMergeLifecycle(s.issueId, projectPath, sourceBranch, { skipDeploy: true }).catch(err => {
          console.warn(`[label-cleanup] postMergeLifecycle re-run failed for ${s.issueId}: ${err}`);
        });
      } catch {
        // non-fatal — best-effort
      }
    }
  } catch (err) {
    console.warn(`[label-cleanup] repairIncompletePostMergeLifecycle failed: ${err}`);
  }
}

/**
 * Startup repair: detect GitHub issues that were manually closed (wontfix/won't-implement/etc.)
 * but still have active Panopticon state (readyForMerge=true or mergeStatus=pending/queued).
 *
 * Clears readyForMerge and sets mergeStatus to 'failed' (or removes from awaiting-merge)
 * so deacon stops sending merge reminders and the issue disappears from the Awaiting Merge page.
 *
 * Fire-and-forget — non-fatal, errors are logged.
 */
export async function repairClosedWontfixIssues(): Promise<void> {
  try {
    const { setReviewStatus } = await import('../review-status.js');
    const statuses = loadReviewStatuses();

    // Issues with active merge state but NOT yet merged — could be stale closed issues
    const candidates = Object.values(statuses).filter(
      s => s.readyForMerge === true && s.mergeStatus !== 'merged',
    );
    if (candidates.length === 0) return;

    for (const s of candidates) {
      const resolved = resolveGitHubIssue(s.issueId);
      if (!resolved.isGitHub) continue;

      try {
        // Check both state AND labels — only act on issues with 'wontfix' label
        // (GitHub's state_reason='completed' is ambiguous: it covers both intentional
        // closures AND issues closed because a PR merged. We only want explicit wontfix.)
        const { stdout } = await execAsync(
          `gh issue view ${resolved.number} --repo ${resolved.owner}/${resolved.repo} --json state,labels --jq '{state: .state, labels: [.labels[].name]}'`,
          { encoding: 'utf-8', timeout: 10000 },
        );
        const parsed = JSON.parse(stdout.trim());
        if (parsed.state !== 'CLOSED') continue;
        if (s.mergeStatus === 'merged') continue; // Already handled by repairMergedLabels

        // Only act on explicitly marked wontfix issues, not just any closed issue
        const hasWontfixLabel = (parsed.labels as string[]).some(
          (l: string) => l === 'wontfix' || l === 'won\'t fix' || l === 'not planned',
        );
        if (hasWontfixLabel) {
          console.log(`[label-cleanup] ${s.issueId} GitHub issue #${resolved.number} is CLOSED (wontfix) — clearing stale readyForMerge state`);
          setReviewStatus(s.issueId, {
            readyForMerge: false,
            mergeStatus: 'failed',
            mergeNotes: 'GitHub issue was closed as wontfix (not via Panopticon merge flow)',
          } as any);

          // Remove workflow labels if present
          for (const label of ['in-review', 'in-progress']) {
            await execAsync(
              `gh issue edit ${resolved.number} --repo ${resolved.owner}/${resolved.repo} --remove-label "${label}" 2>/dev/null || true`,
              { encoding: 'utf-8' },
            );
          }
          continue;
        }

        // Also handle issues closed with 'merged' label but internal state not updated
        // (e.g. merged outside Panopticon flow, or PR merged but post-merge lifecycle
        // cleared prUrl before updating mergeStatus).
        const hasMergedLabel = (parsed.labels as string[]).some(
          (l: string) => l === 'merged',
        );
        if (hasMergedLabel) {
          console.log(`[label-cleanup] ${s.issueId} GitHub issue #${resolved.number} is CLOSED (merged) — repairing internal state`);
          setReviewStatus(s.issueId, {
            readyForMerge: false,
            mergeStatus: 'merged',
            mergeNotes: 'Repaired by startup sweep — issue was merged on GitHub',
          } as any);
          continue;
        }
      } catch {
        // non-fatal — best-effort
      }
    }
  } catch (err) {
    console.warn(`[label-cleanup] repairClosedWontfixIssues failed: ${err}`);
  }
}

/**
 * Startup repair: detect issues with readyForMerge=true pointing at a PR that is
 * CLOSED (not merged) on GitHub. These are the residue of cancel-flow divergence
 * (PAN-509): before the Run 6 fix in closeIssuePullRequest(), `/cancel` closed the
 * PR but left the stale prUrl in review-status, so a subsequent re-review cycle
 * marked readyForMerge=true against a dead PR. The Run 6 triggerMerge validator
 * now refuses to merge in this state, but the data is still stuck — this sweep
 * clears it so the issue re-enters the pipeline and a fresh PR gets created.
 *
 * Fire-and-forget — non-fatal, errors are logged.
 */
export async function repairClosedPRs(): Promise<void> {
  try {
    const { setReviewStatus } = await import('../review-status.js');
    const statuses = loadReviewStatuses();

    // Don't restrict to readyForMerge — the Run 6 triggerMerge validator already
    // flips readyForMerge=false when it refuses to merge against a CLOSED PR, so
    // those issues sit in `mergeStatus=failed` with a stale prUrl. Sweep any issue
    // with a prUrl that isn't marked merged; GitHub is the source of truth.
    const candidates = Object.values(statuses).filter(
      s => s.mergeStatus !== 'merged' && s.prUrl,
    );
    if (candidates.length === 0) return;

    for (const s of candidates) {
      const resolved = resolveGitHubIssue(s.issueId);
      if (!resolved.isGitHub || !s.prUrl) continue;

      const prNumMatch = s.prUrl.match(/\/pull\/(\d+)$/);
      if (!prNumMatch) continue;
      const prNumber = prNumMatch[1];

      try {
        const { stdout } = await execAsync(
          `gh pr view ${prNumber} --repo ${resolved.owner}/${resolved.repo} --json state --jq .state`,
          { encoding: 'utf-8', timeout: 10000 },
        );
        const state = stdout.trim();
        if (state !== 'CLOSED') continue;

        console.log(`[label-cleanup] ${s.issueId} PR #${prNumber} is CLOSED (not merged) — clearing stale readyForMerge and prUrl so issue re-enters pipeline`);
        setReviewStatus(s.issueId, {
          prUrl: undefined,
          readyForMerge: false,
          mergeStatus: undefined,
          reviewStatus: 'pending',
          mergeNotes: `Cleared stale closed PR #${prNumber} on startup (repairClosedPRs). Re-run review to create a fresh PR.`,
        });
      } catch {
        // non-fatal — best-effort
      }
    }
  } catch (err) {
    console.warn(`[label-cleanup] repairClosedPRs failed: ${err}`);
  }
}

async function cleanupLabelsLinear(ctx: LifecycleContext, apiKey: string): Promise<StepResult> {
  const step = 'label-cleanup:merged';
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
      return stepSkipped(step, ['Issue not found for label cleanup']);
    }

    const issue = results.nodes[0];

    // Find or create merged label
    const labelSearch = await client.issueLabels({ filter: { name: { eq: MERGED_LABEL } } });
    let mergedLabelId: string;
    if (labelSearch.nodes.length > 0) {
      mergedLabelId = labelSearch.nodes[0].id;
    } else {
      const created = await client.createIssueLabel({ name: MERGED_LABEL, color: `#${MERGED_COLOR}` });
      const createdLabel = await created.issueLabel;
      mergedLabelId = createdLabel ? createdLabel.id : '';
    }

    if (mergedLabelId) {
      const existingLabels = await issue.labels();
      // Remove workflow labels, add merged
      const filteredIds = existingLabels.nodes
        .filter(l => !LABELS_TO_REMOVE.includes(l.name))
        .map(l => l.id);
      if (!filteredIds.includes(mergedLabelId)) {
        filteredIds.push(mergedLabelId);
      }
      await issue.update({ labelIds: filteredIds });
    }

    return stepOk(step, [
      `Applied '${MERGED_LABEL}' label on Linear ${ctx.issueId}`,
      `Removed: ${LABELS_TO_REMOVE.join(', ')}`,
    ]);
  } catch (err) {
    return stepFailed(step, `Linear label cleanup failed: ${(err as Error).message}`);
  }
}
