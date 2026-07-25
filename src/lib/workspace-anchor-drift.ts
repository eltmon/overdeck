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

const execFileAsync = promisify(execFile);

export type WorkspaceAnchorDriftVerdict =
  | { kind: 'current'; currentAnchor: HeadAnchor }
  | { kind: 'benign'; currentAnchor: HeadAnchor; changedRepos?: string[] }
  | { kind: 'drifted'; currentAnchor: HeadAnchor; changedRepos?: string[] }
  | { kind: 'unreadable'; currentAnchor?: HeadAnchor };

async function haveSameTree(repoPath: string, leftCommit: string, rightCommit: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    execFileAsync('git', ['rev-parse', `${leftCommit}^{tree}`], { cwd: repoPath, encoding: 'utf-8' }),
    execFileAsync('git', ['rev-parse', `${rightCommit}^{tree}`], { cwd: repoPath, encoding: 'utf-8' }),
  ]);
  return left.stdout.trim() === right.stdout.trim();
}

async function isBenignMove(
  repoPath: string,
  leftCommit: string,
  rightCommit: string,
  baseRef: string,
): Promise<boolean> {
  if (await haveSameTree(repoPath, leftCommit, rightCommit)) return true;
  if (await haveSameEffectiveCodeCommit(repoPath, leftCommit, rightCommit)) return true;
  return haveSameCodeContribution(repoPath, leftCommit, rightCommit, baseRef);
}

/** Compare a persisted workspace anchor with a fresh producer-issued snapshot. */
export async function evaluateWorkspaceAnchorDrift(
  issueId: string,
  workspacePath: string,
  storedAnchor: HeadAnchor,
): Promise<WorkspaceAnchorDriftVerdict> {
  const currentAnchor = await snapshotWorkspaceHeadsPromise(issueId, workspacePath);
  if (!currentAnchor) return { kind: 'unreadable' };
  if (storedAnchor === currentAnchor) return { kind: 'current', currentAnchor };

  const storedHeads = parseCompositeSnapshot(storedAnchor);
  const currentHeads = parseCompositeSnapshot(currentAnchor);
  const storedIsComposite = storedHeads.size > 0;
  const currentIsComposite = currentHeads.size > 0;

  if (storedIsComposite !== currentIsComposite) {
    return { kind: 'drifted', currentAnchor };
  }

  try {
    const { resolveWorkspaceRepoRootsSync } = await import('./project-repos.js');
    const roots = resolveWorkspaceRepoRootsSync(issueId, workspacePath);

    if (!storedIsComposite) {
      const root = roots[0];
      if (!root) return { kind: 'unreadable', currentAnchor };
      const benign = await isBenignMove(
        root.dir,
        storedAnchor,
        currentAnchor,
        `origin/${root.targetBranch}`,
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
        return { kind: 'unreadable', currentAnchor };
      }
      if (!await isBenignMove(
        root.dir,
        storedHead,
        currentHead,
        `origin/${root.targetBranch}`,
      )) {
        return { kind: 'drifted', currentAnchor, changedRepos };
      }
    }

    return { kind: 'benign', currentAnchor, changedRepos };
  } catch {
    return { kind: 'unreadable', currentAnchor };
  }
}
