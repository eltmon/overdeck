import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findPlanSync } from './xbrief/io.js';
import { promisify } from 'node:util';
import { getForgeAdapter } from './forge.js';
import { extractNumber } from './issue-id.js';
import {
  ensureMergeSetForIssue,
  upsertMergeSet,
  withRepoArtifactUrl,
  withRepoState,
  type MergeSet,
  type MergeSetRepoState,
} from './merge-set.js';
import { emitActivityEntry } from './activity-logger.js';

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
}

/** Build the markdown body of an issue's review artifact (PR description). */
async function buildRichReviewArtifactBody(issueId: string, workspacePath: string): Promise<string> {
  const lines: string[] = [];

  // Non-closing reference on purpose: a closing keyword ("Closes #N") hands
  // close authority to GitHub, which fires the moment the PR's head becomes
  // reachable from main and races the pipeline's verifying_on_main → close-out
  // lifecycle (the first UAT batch promote closed 2 of 3 member issues
  // mid-handoff, 2026-06-11). Overdeck's close-out owns issue closing.
  lines.push(`**Issue:** #${extractNumber(issueId) ?? issueId}`);
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
}

/** Create or update the review artifacts (PRs/MRs) for every repo in an issue's merge set. */
export async function createReviewArtifactsForIssue(
  issueId: string,
  workspacePath: string
): Promise<ReviewArtifactCreationResult> {
  let mergeSet = ensureMergeSetForIssue(issueId);
  if (!mergeSet) {
    return { mergeSet: null, artifacts: [] };
  }

  const body = await buildRichReviewArtifactBody(issueId, workspacePath);
  const artifacts: ReviewArtifactCreationResult['artifacts'] = [];

  for (const repo of mergeSet.repos) {
    const repoWorkspacePath = getRepoWorkspacePath(workspacePath, mergeSet, repo);
    const hasChanges = await repoHasChanges(repoWorkspacePath, repo.targetBranch);

    if (!hasChanges) {
      mergeSet = withRepoState(mergeSet, repo.repoKey, {
        repoReview: 'skipped',
        repoTests: 'skipped',
        rebaseStatus: 'skipped',
        repoVerification: 'skipped',
        repoMerge: 'skipped',
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
      mergeSet = withRepoArtifactUrl(mergeSet, repo.repoKey, artifact.url, artifact.id);
    }
    mergeSet = withRepoState(mergeSet, repo.repoKey, {
      artifactId: artifact.id,
      repoReview: 'pending',
      repoTests: 'pending',
      rebaseStatus: 'pending',
      repoVerification: 'pending',
      repoMerge: 'pending',
    });
    if (artifact.created) {
      const repoSuffix = mergeSet.repos.length > 1 ? ` (${repo.repoKey})` : '';
      emitActivityEntry({
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
  upsertMergeSet(mergeSet);

  return { mergeSet, artifacts };
}
