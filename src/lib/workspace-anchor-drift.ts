import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  type HeadAnchor,
  parseCompositeSnapshot,
  snapshotWorkspaceHeadsPromise,
} from './git-utils.js';
import {
  haveSameCodeContribution,
  haveSameEffectiveCodeCommit,
} from './pipeline-state-paths.js';
import type { ReviewStatus } from './review-status-reconcile.js';

const execFileAsync = promisify(execFile);

export type ReviewStatusUpdate = Omit<Partial<ReviewStatus>, 'reviewedAtCommit' | 'lastVerifiedCommit'> & {
  reviewedAtCommit?: HeadAnchor;
  lastVerifiedCommit?: HeadAnchor;
};

export type WorkspaceAnchorDriftVerdict =
  | { kind: 'current'; currentAnchor: HeadAnchor }
  | { kind: 'benign'; currentAnchor: HeadAnchor; changedRepos?: string[] }
  | { kind: 'drifted'; currentAnchor: HeadAnchor; changedRepos?: string[] }
  | { kind: 'unreadable' };

export interface WorkspaceAnchorDriftChecks {
  sameTree(repoPath: string, leftCommit: string, rightCommit: string): Promise<boolean>;
  sameEffectiveCode(repoPath: string, leftCommit: string, rightCommit: string): Promise<boolean>;
  sameCodeContribution(
    repoPath: string,
    leftCommit: string,
    rightCommit: string,
    baseRef: string,
  ): Promise<boolean>;
}

async function haveSameTree(repoPath: string, leftCommit: string, rightCommit: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    execFileAsync('git', ['rev-parse', `${leftCommit}^{tree}`], { cwd: repoPath, encoding: 'utf-8' }),
    execFileAsync('git', ['rev-parse', `${rightCommit}^{tree}`], { cwd: repoPath, encoding: 'utf-8' }),
  ]);
  return left.stdout.trim() === right.stdout.trim();
}

const DEFAULT_CHECKS: WorkspaceAnchorDriftChecks = {
  sameTree: haveSameTree,
  sameEffectiveCode: haveSameEffectiveCodeCommit,
  sameCodeContribution: haveSameCodeContribution,
};

async function isBenignMove(
  repoPath: string,
  leftCommit: string,
  rightCommit: string,
  baseRef: string,
  checks: WorkspaceAnchorDriftChecks,
): Promise<boolean> {
  try {
    if (await checks.sameTree(repoPath, leftCommit, rightCommit)) return true;
  } catch { /* a failed proof falls through to the next independent check */ }
  try {
    if (await checks.sameEffectiveCode(repoPath, leftCommit, rightCommit)) return true;
  } catch { /* a failed proof falls through to the next independent check */ }
  try {
    return await checks.sameCodeContribution(repoPath, leftCommit, rightCommit, baseRef);
  } catch {
    return false;
  }
}

/** Compare a persisted workspace anchor with a fresh producer-issued snapshot. */
export async function evaluateWorkspaceAnchorDrift(
  issueId: string,
  workspacePath: string,
  storedAnchor: HeadAnchor,
  checks: WorkspaceAnchorDriftChecks = DEFAULT_CHECKS,
): Promise<WorkspaceAnchorDriftVerdict> {
  const currentAnchor = await snapshotWorkspaceHeadsPromise(issueId, workspacePath);
  if (!currentAnchor) return { kind: 'unreadable' };
  if (storedAnchor === currentAnchor) return { kind: 'current', currentAnchor };

  const storedHeads = parseCompositeSnapshot(storedAnchor);
  const currentHeads = parseCompositeSnapshot(currentAnchor);
  const storedIsComposite = storedHeads.size > 0;
  const currentIsComposite = currentHeads.size > 0;

  if (storedIsComposite !== currentIsComposite) {
    // PAN-3254: a composite/bare SHAPE disagreement is a producer disagreement
    // (one side snapshotted the never-moving polyrepo wrapper HEAD, the other
    // the per-repo composite) — not evidence that code changed. Treating it as
    // drift re-drove MIN-901 through 426 identical review cycles in 19.5 h.
    // Unreadable → callers skip and preserve the existing verdict; a genuine
    // post-review push produces a well-formed anchor that differs by CONTENT.
    return { kind: 'unreadable' };
  }

  try {
    const { resolveWorkspaceRepoRootsSync } = await import('./project-repos.js');
    const roots = resolveWorkspaceRepoRootsSync(issueId, workspacePath);

    if (!storedIsComposite) {
      const root = roots[0];
      if (!root) return { kind: 'drifted', currentAnchor };
      const benign = await isBenignMove(
        root.dir,
        storedAnchor,
        currentAnchor,
        `origin/${root.targetBranch}`,
        checks,
      );
      return benign
        ? { kind: 'benign', currentAnchor }
        : { kind: 'drifted', currentAnchor };
    }

    const allRepoKeys = new Set([...storedHeads.keys(), ...currentHeads.keys()]);
    if (
      storedHeads.size !== currentHeads.size ||
      [...allRepoKeys].some(repoKey => !storedHeads.has(repoKey) || !currentHeads.has(repoKey))
    ) {
      return { kind: 'drifted', currentAnchor, changedRepos: [...allRepoKeys].sort() };
    }

    const changedRepos = [...allRepoKeys]
      .filter(repoKey => storedHeads.get(repoKey) !== currentHeads.get(repoKey))
      .sort();
    const rootsByKey = new Map(roots.map(root => [root.repoKey, root]));

    for (const repoKey of changedRepos) {
      const root = rootsByKey.get(repoKey);
      const storedHead = storedHeads.get(repoKey);
      const currentHead = currentHeads.get(repoKey);
      if (!root || !storedHead || !currentHead) {
        return { kind: 'drifted', currentAnchor, changedRepos };
      }
      if (!await isBenignMove(
        root.dir,
        storedHead,
        currentHead,
        `origin/${root.targetBranch}`,
        checks,
      )) {
        return { kind: 'drifted', currentAnchor, changedRepos };
      }
    }

    return { kind: 'benign', currentAnchor, changedRepos };
  } catch {
    return { kind: 'drifted', currentAnchor };
  }
}
