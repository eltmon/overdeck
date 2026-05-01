import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { queryBeadsForIssue } from './beads-query.js';
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

/**
 * Build the PR/MR body from the workspace planning artifacts.
 * Shared by both `pan done` and dashboard review startup.
 */
export async function buildRichReviewArtifactBody(issueId: string, workspacePath: string): Promise<string> {
  const lines: string[] = [];

  lines.push(`Closes #${extractNumber(issueId) ?? issueId}`);
  lines.push('');

  try {
    const planPath = join(workspacePath, '.planning', 'plan.vbrief.json');
    if (existsSync(planPath)) {
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
    const beads = await queryBeadsForIssue(workspacePath, issueId);
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
}

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
      mergeSet = withRepoArtifactUrl(mergeSet, repo.repoKey, artifact.url, artifact.id);
    }
    mergeSet = withRepoState(mergeSet, repo.repoKey, {
      artifactId: artifact.id,
      reviewStatus: 'pending',
      testStatus: 'pending',
      rebaseStatus: 'pending',
      verificationStatus: 'pending',
      mergeStatus: 'pending',
    });
    if (artifact.created) {
      const repoSuffix = mergeSet.repos.length > 1 ? ` (${repo.repoKey})` : '';
      emitActivityEntry({
        source: 'merge-agent',
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
