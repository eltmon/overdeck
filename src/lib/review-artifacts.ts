import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Data, Effect } from 'effect';
import { findPlanSync } from './vbrief/io.js';
import { promisify } from 'node:util';
import { queryBeadsForIssue } from './beads-query.js';
import { getForgeAdapter } from './forge.js';
import { extractNumberSync } from './issue-id.js';
import {
  ensureMergeSetForIssueSync,
  upsertMergeSetSync,
  withRepoArtifactUrlSync,
  withRepoStateSync,
  type MergeSet,
  type MergeSetRepoState,
} from './merge-set.js';
import { emitActivityEntrySync } from './activity-logger.js';

const execAsync = promisify(exec);

export interface ReviewArtifactCreationResult {
  mergeSet: MergeSet | null;
  artifacts: Array<{
    repoKey: string;
    created: boolean;
    skipped: boolean;
    url?: string;
    id?: string;
  }>;
}async function buildRichReviewArtifactBodyPromise(issueId: string, workspacePath: string): Promise<string> {
  const lines: string[] = [];

  lines.push(`Closes #${extractNumberSync(issueId) ?? issueId}`);
  lines.push('');

  try {
    const planPath = findPlanSync(workspacePath);
    if (planPath && existsSync(planPath)) {
      const raw = await readFile(planPath, 'utf-8');
      const doc = JSON.parse(raw);
      const items: Array<{ status: string; title: string }> = doc?.plan?.items ?? [];
      if (items.length > 0) {
        lines.push('## Acceptance Criteria');
        lines.push('');
        for (const item of items) {
          const checked = item.status === 'completed' ? 'x' : ' ';
          lines.push(`- [${checked}] ${item.title}`);
        }
        lines.push('');
      }
    }
  } catch {
    // Optional body enrichment only.
  }

  try {
    const beads = await Effect.runPromise(queryBeadsForIssue(workspacePath, issueId));
    if (beads.length > 0) {
      lines.push('## Implementation Tasks');
      lines.push('');
      for (const bead of beads) {
        const checked = bead.status === 'closed' ? 'x' : ' ';
        lines.push(`- [${checked}] ${bead.title.replace(/^[^:]+:\s*/, '')}`);
      }
      lines.push('');
    }
  } catch {
    // Optional body enrichment only.
  }

  return lines.join('\n').trim() || `Automated review artifact for ${issueId}`;
}

function getRepoWorkspacePath(workspacePath: string, mergeSet: MergeSet, repo: MergeSetRepoState): string {
  return mergeSet.workspaceType === 'polyrepo'
    ? join(workspacePath, repo.repoKey)
    : workspacePath;
}

async function repoHasChanges(repoWorkspacePath: string, targetBranch: string): Promise<boolean> {
  if (!existsSync(join(repoWorkspacePath, '.git'))) return false;

  try {
    await execAsync(`git fetch origin ${targetBranch}`, {
      cwd: repoWorkspacePath,
      encoding: 'utf-8',
      timeout: 30000,
    });
  } catch {
    // Non-fatal. Diff may still work from local refs.
  }

  try {
    await execAsync(`git diff --quiet origin/${targetBranch}...HEAD`, {
      cwd: repoWorkspacePath,
      encoding: 'utf-8',
      timeout: 15000,
    });
    return false;
  } catch (err: any) {
    if (typeof err?.code === 'number' && err.code === 1) return true;
    return true;
  }
}async function createReviewArtifactsForIssuePromise(
  issueId: string,
  workspacePath: string
): Promise<ReviewArtifactCreationResult> {
  let mergeSet = ensureMergeSetForIssueSync(issueId);
  if (!mergeSet) {
    return { mergeSet: null, artifacts: [] };
  }

  const body = await Effect.runPromise(buildRichReviewArtifactBody(issueId, workspacePath));
  const artifacts: ReviewArtifactCreationResult['artifacts'] = [];

  for (const repo of mergeSet.repos) {
    const repoWorkspacePath = getRepoWorkspacePath(workspacePath, mergeSet, repo);
    const hasChanges = await repoHasChanges(repoWorkspacePath, repo.targetBranch);

    if (!hasChanges) {
      mergeSet = withRepoStateSync(mergeSet, repo.repoKey, {
        reviewStatus: 'skipped',
        testStatus: 'skipped',
        rebaseStatus: 'skipped',
        verificationStatus: 'skipped',
        mergeStatus: 'skipped',
      });
      artifacts.push({ repoKey: repo.repoKey, created: false, skipped: true });
      continue;
    }

    const adapter = getForgeAdapter(repo.forge);
    const artifact = await adapter.createReviewArtifact({
      title: issueId,
      body,
      sourceBranch: repo.sourceBranch,
      targetBranch: repo.targetBranch,
      cwd: repoWorkspacePath,
    });

    if (artifact.url) {
      mergeSet = withRepoArtifactUrlSync(mergeSet, repo.repoKey, artifact.url, artifact.id);
    }
    mergeSet = withRepoStateSync(mergeSet, repo.repoKey, {
      artifactId: artifact.id,
      reviewStatus: 'pending',
      testStatus: 'pending',
      rebaseStatus: 'pending',
      verificationStatus: 'pending',
      mergeStatus: 'pending',
    });
    if (artifact.created) {
      const repoSuffix = mergeSet.repos.length > 1 ? ` (${repo.repoKey})` : '';
      emitActivityEntrySync({
        source: 'ship',
        level: 'info',
        message: `Merge request created for ${issueId}${repoSuffix}`,
        details: artifact.url,
        issueId,
      });
    }
    artifacts.push({
      repoKey: repo.repoKey,
      created: artifact.created,
      skipped: false,
      url: artifact.url,
      id: artifact.id,
    });
  }

  mergeSet = {
    ...mergeSet,
    status: 'reviewing',
    updatedAt: new Date().toISOString(),
  };
  upsertMergeSetSync(mergeSet);

  return { mergeSet, artifacts };
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Tagged error for review-artifacts Effect variants. */
export class ReviewArtifactError extends Data.TaggedError('ReviewArtifactError')<{
  readonly issueId: string;
  readonly stage: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Effect variant of `buildRichReviewArtifactBody`. */
export const buildRichReviewArtifactBody = (
  issueId: string,
  workspacePath: string,
): Effect.Effect<string, ReviewArtifactError> =>
  Effect.tryPromise({
    try: () => buildRichReviewArtifactBodyPromise(issueId, workspacePath),
    catch: (cause) =>
      new ReviewArtifactError({
        issueId,
        stage: 'buildRichReviewArtifactBody',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `createReviewArtifactsForIssue`. */
export const createReviewArtifactsForIssue = (
  issueId: string,
  workspacePath: string,
): Effect.Effect<ReviewArtifactCreationResult, ReviewArtifactError> =>
  Effect.tryPromise({
    try: () => createReviewArtifactsForIssuePromise(issueId, workspacePath),
    catch: (cause) =>
      new ReviewArtifactError({
        issueId,
        stage: 'createReviewArtifactsForIssue',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

