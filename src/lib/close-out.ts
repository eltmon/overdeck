/**
 * Merge detection for close-out and residue reaping.
 *
 * The close-out ceremony itself lives in `lifecycle/workflows.ts closeOut()`;
 * this module only decides whether a feature branch has landed on main.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { runGh } from './github-quota/run-gh.js';

const execAsync = promisify(exec);

/** How long a "no merged PR found" answer for one `(project, branch, tip)` is trusted. */
export const CLOSE_OUT_NEGATIVE_TTL_MS = 60 * 60_000;

/** `${projectPath}\0${branchName}\0${tipSha}` -> the ms timestamp it was last answered "not merged". */
const negativeAnswerCache = new Map<string, number>();

/** Test-only: clear the negative-answer cache between test cases. */
export function resetCloseOutCacheForTests(): void {
  negativeAnswerCache.clear();
}

function negativeCacheKey(projectPath: string, branchName: string, tipSha: string): string {
  return `${projectPath}\0${branchName}\0${tipSha}`;
}

// Planning/pipeline artifact paths ignored when deciding whether a branch
// still holds unmerged CODE. `.pan/` is the current artifact home (PAN-967);
// `.planning/` and `docs/prds/` are legacy; `.overdeck/` is workspace runtime.
const ARTIFACT_PATH_PREFIXES = ['.pan/', '.planning/', 'docs/prds/', '.overdeck/'];
const ARTIFACT_EXCLUSIONS = ARTIFACT_PATH_PREFIXES
  .map((prefix) => `':!${prefix.slice(0, -1)}'`)
  .join(' ');

/**
 * Squash-merge detection via the forge. A squash-merged branch is never an
 * ancestor of main and its three-dot diff never empties (the pre-squash
 * commits stay visible against the merge-base), so pure-git checks report it
 * unmerged forever. The merged PR is the authoritative record: if a merged PR
 * has this branch as head, its merge commit landed on main, and the branch has
 * no post-merge code commits, the branch is merged. Returns false on any
 * failure (no gh, GitLab remote, no PR) so callers fall through conservatively.
 *
 * The forge lookup is metered through `runGh` (PAN-4291: it used to run
 * unmetered, hiding real GraphQL spend from the ledger) and a "no merged PR"
 * answer is cached for `CLOSE_OUT_NEGATIVE_TTL_MS` per `(project, branch,
 * tip)`, since the closed-issue reaper calls this every tick for the same
 * still-unmerged branch. Only a negative answer is cached — a failure (no
 * gh, offline, rate-limited) is retried on the very next call.
 */
async function isSquashMergedViaPr(
  branchName: string,
  tipRef: string,
  projectPath: string,
): Promise<boolean> {
  let tipSha: string;
  try {
    const { stdout } = await execAsync(`git rev-parse "${tipRef}"`, { cwd: projectPath, encoding: 'utf-8' });
    tipSha = stdout.trim();
  } catch {
    return false;
  }

  const key = negativeCacheKey(projectPath, branchName, tipSha);
  const answeredAt = negativeAnswerCache.get(key);
  if (answeredAt !== undefined && Date.now() - answeredAt < CLOSE_OUT_NEGATIVE_TTL_MS) return false;

  let prs: Array<{ headRefOid?: string; mergeCommit?: { oid?: string } }>;
  try {
    const { stdout } = await runGh(
      ['pr', 'list', '--head', branchName, '--state', 'merged', '--json', 'headRefOid,mergeCommit', '--limit', '1'],
      { cwd: projectPath, timeout: 15_000 },
    );
    prs = JSON.parse(stdout) as Array<{ headRefOid?: string; mergeCommit?: { oid?: string } }>;
  } catch {
    return false;
  }

  const pr = prs[0];
  if (!pr?.headRefOid || !pr.mergeCommit?.oid) {
    negativeAnswerCache.set(key, Date.now());
    return false;
  }

  try {
    // The PR's merge commit must actually be on main.
    await execAsync(`git merge-base --is-ancestor ${pr.mergeCommit.oid} main`, {
      cwd: projectPath,
      encoding: 'utf-8',
    });
  } catch {
    return false;
  }

  if (tipSha === pr.headRefOid) return true;

  try {
    // Commits after the merged PR head: merged only if they touch artifacts alone.
    const { stdout: filesOut } = await execAsync(
      `git log ${pr.headRefOid}..${tipRef} --name-only --pretty=format:`,
      { cwd: projectPath, encoding: 'utf-8' },
    );
    const files = filesOut.split('\n').map((line) => line.trim()).filter(Boolean);
    const merged = files.every((file) => ARTIFACT_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)));
    if (!merged) negativeAnswerCache.set(key, Date.now());
    return merged;
  } catch {
    return false;
  }
}

/**
 * Check if a feature branch has been merged into main.
 *
 * Uses `git merge-base --is-ancestor` for regular merges, plus a
 * code-diff fallback to detect squash merges where the branch still exists.
 * PAN-3917: git is the only authority — the merge-status row that used to be
 * consulted as a hint is gone.
 */
export async function isBranchMerged(
  branchName: string,
  projectPath: string,
): Promise<{ status: 'merged' | 'unmerged' | 'no-branch'; message: string }> {
  // Check if branch exists locally
  const { stdout: branchExists } = await execAsync(
    `git branch --list "${branchName}" 2>/dev/null || true`,
    { cwd: projectPath, encoding: 'utf-8' },
  );

  if (branchExists.trim()) {
    // Use merge-base --is-ancestor: checks if the branch tip is reachable from main
    // This works for regular merges, squash merges, and cherry-picks
    try {
      await execAsync(
        `git merge-base --is-ancestor ${branchName} main`,
        { cwd: projectPath, encoding: 'utf-8' },
      );
      return { status: 'merged', message: 'All commits merged to main' };
    } catch {
      // --is-ancestor fails for squash merges where the branch still exists.
      // Check if the code diff (excluding planning artifacts) is empty — if so,
      // the code was squash-merged and only planning files remain on the branch.
      try {
        const { stdout: codeDiff } = await execAsync(
          `git diff main...${branchName} -- ${ARTIFACT_EXCLUSIONS} 2>/dev/null || true`,
          { cwd: projectPath, encoding: 'utf-8' },
        );
        if (!codeDiff.trim()) {
          return { status: 'merged', message: 'Code changes squash-merged to main (only planning artifacts remain on branch)' };
        }
      } catch {
        // diff failed — fall through to unmerged report
      }

      // The three-dot diff can never go empty for a squash-merged branch unless
      // main was merged back into it afterwards — the pre-squash commits stay
      // visible relative to the merge-base forever. Ask the forge: a merged PR
      // whose head is this branch, with no post-merge code commits, IS merged.
      if (await isSquashMergedViaPr(branchName, branchName, projectPath)) {
        return { status: 'merged', message: `Merged PR found for ${branchName} (squash merge)` };
      }

      const { stdout: unmerged } = await execAsync(
        `git log main..${branchName} --oneline 2>/dev/null || true`,
        { cwd: projectPath, encoding: 'utf-8' },
      );
      const count = unmerged.trim() ? unmerged.trim().split('\n').length : 0;
      return {
        status: 'unmerged',
        message: `${count} unmerged commit(s) on ${branchName}. Merge before closing out.`,
      };
    }
  }

  // Check remote
  const { stdout: remoteBranch } = await execAsync(
    `git ls-remote --heads origin "${branchName}" 2>/dev/null || true`,
    { cwd: projectPath, encoding: 'utf-8' },
  );

  if (remoteBranch.trim()) {
    await execAsync(`git fetch origin ${branchName}`, { cwd: projectPath }).catch(() => {});
    try {
      await execAsync(
        `git merge-base --is-ancestor origin/${branchName} main`,
        { cwd: projectPath, encoding: 'utf-8' },
      );
      return { status: 'merged', message: 'Remote branch fully merged' };
    } catch {
      // Squash-merge detection for remote branch
      try {
        const { stdout: codeDiff } = await execAsync(
          `git diff main...origin/${branchName} -- ${ARTIFACT_EXCLUSIONS} 2>/dev/null || true`,
          { cwd: projectPath, encoding: 'utf-8' },
        );
        if (!codeDiff.trim()) {
          return { status: 'merged', message: 'Remote code changes squash-merged to main (only planning artifacts remain on branch)' };
        }
      } catch {
        // diff failed — fall through
      }

      if (await isSquashMergedViaPr(branchName, `origin/${branchName}`, projectPath)) {
        return { status: 'merged', message: `Merged PR found for ${branchName} (squash merge)` };
      }

      const { stdout: remoteUnmerged } = await execAsync(
        `git log main..origin/${branchName} --oneline 2>/dev/null || true`,
        { cwd: projectPath, encoding: 'utf-8' },
      );
      const count = remoteUnmerged.trim() ? remoteUnmerged.trim().split('\n').length : 0;
      return {
        status: 'unmerged',
        message: `${count} unmerged commit(s) on remote ${branchName}.`,
      };
    }
  }

  // No branch at all — assume squash-merged and branch deleted
  return { status: 'no-branch', message: 'Branch already cleaned up (squash-merged)' };
}
