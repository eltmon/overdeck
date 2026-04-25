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
