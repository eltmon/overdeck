/** DoD rows 1–2 fallback (PAN-5209): a non-GitHub issue with no GitHub PR lands through merged forge artifacts. Read-only. */
import { exec } from 'child_process';
import { promisify } from 'util';
import { getForgeAdapter } from '../forge.js';
import { resolveProjectReposForIssue, type ResolvedProjectRepo } from '../project-repos.js';
import { resolveTargetComparison } from './verify-merged.js';

const execAsync = promisify(exec);

export type RepoLandingState = 'merged' | 'no-branch-work' | 'unlanded' | 'unverifiable';
export interface RepoLanding { repoKey: string; state: RepoLandingState; url?: string; reason: string }
export interface RepoLandingEvidence { repos: RepoLanding[] }

export type ForgeMergeVerdict =
  | { kind: 'complete'; text: string }
  | { kind: 'incomplete'; text: string }
  | { kind: 'unverifiable'; text: string };

export async function assessRepoLanding(repo: ResolvedProjectRepo): Promise<RepoLanding> {
  const { repoKey, repoPath, sourceBranch, targetBranch, forge } = repo;

  try {
    const artifact = await getForgeAdapter(forge).findMergedArtifact({ sourceBranch, targetBranch, cwd: repoPath });
    if (artifact) return { repoKey, state: 'merged', url: artifact.url, reason: '' };
  } catch (err) {
    return { repoKey, state: 'unverifiable', reason: `${repoKey}: merged-artifact lookup failed: ${(err as Error).message}` };
  }

  const comparison = await resolveTargetComparison(repoPath, targetBranch);
  if (comparison.ref === null) {
    return { repoKey, state: 'unverifiable', reason: `${repoKey}: git read failed: ${comparison.error}` };
  }
  if (comparison.note) {
    return { repoKey, state: 'unverifiable', reason: `${repoKey}: git read failed: ${comparison.note}` };
  }
  const ref = comparison.ref;

  try {
    const { stdout: remoteBranch } = await execAsync(
      `git ls-remote --heads origin "${sourceBranch}"`,
      { cwd: repoPath, encoding: 'utf-8', timeout: 30000 },
    );

    let tip: string;
    if (remoteBranch.trim()) {
      await execAsync(
        `git fetch origin +refs/heads/${sourceBranch}:refs/remotes/origin/${sourceBranch}`,
        { cwd: repoPath, encoding: 'utf-8', timeout: 30000 },
      );
      tip = `origin/${sourceBranch}`;
    } else {
      try {
        await execAsync(`git rev-parse --verify --quiet refs/heads/${sourceBranch}^{commit}`, { cwd: repoPath, encoding: 'utf-8' });
        tip = `refs/heads/${sourceBranch}`;
      } catch {
        return { repoKey, state: 'no-branch-work', reason: `${repoKey}: no ${sourceBranch} branch` };
      }
    }

    try {
      await execAsync(`git merge-base --is-ancestor ${tip} ${ref}`, { cwd: repoPath, encoding: 'utf-8' });
    } catch {
      if (await addsNoChanges(repoPath, ref, tip)) {
        return { repoKey, state: 'no-branch-work', reason: `${repoKey}: ${sourceBranch} adds no changes over ${ref}` };
      }
      return { repoKey, state: 'unlanded', reason: `${repoKey}: ${sourceBranch} is not on ${ref} and has no merged review artifact` };
    }

    const { stdout: tipShaRaw } = await execAsync(`git rev-parse ${tip}`, { cwd: repoPath, encoding: 'utf-8' });
    const tipSha = tipShaRaw.trim();
    const { stdout: firstParentRaw } = await execAsync(`git rev-list --first-parent ${ref}`, { cwd: repoPath, encoding: 'utf-8' });
    const onFirstParentLine = firstParentRaw.split('\n').map((line) => line.trim()).includes(tipSha);

    return onFirstParentLine
      ? { repoKey, state: 'no-branch-work', reason: `${repoKey}: ${sourceBranch} points at ${ref} history` }
      : { repoKey, state: 'unlanded', reason: `${repoKey}: ${sourceBranch} work reached ${ref} without a merged review artifact` };
  } catch (err) {
    return { repoKey, state: 'unverifiable', reason: `${repoKey}: git read failed: ${(err as Error).message}` };
  }
}

/** `git diff --quiet <ref>...<tip>`: exit 0 = no net change since the merge-base, 1 = changes; any other failure throws to the caller's unverifiable catch. */
async function addsNoChanges(repoPath: string, ref: string, tip: string): Promise<boolean> {
  try {
    await execAsync(`git diff --quiet ${ref}...${tip}`, { cwd: repoPath, encoding: 'utf-8' });
    return true;
  } catch (err) {
    if ((err as { code?: unknown }).code === 1) return false;
    throw err;
  }
}

export async function readRepoLandingEvidence(issueId: string): Promise<RepoLandingEvidence> {
  const repos = (resolveProjectReposForIssue(issueId) ?? []).filter((repo) => repo.required);
  return { repos: await Promise.all(repos.map((repo) => assessRepoLanding(repo))) };
}

export async function readForgeMergeVerdict(read: () => Promise<RepoLandingEvidence>): Promise<ForgeMergeVerdict> {
  let evidence: RepoLandingEvidence;
  try {
    evidence = await read();
  } catch (err) {
    return { kind: 'unverifiable', text: `forge merge state read failed: ${(err as Error).message}` };
  }

  const { repos } = evidence;
  const unverifiable = repos.filter((repo) => repo.state === 'unverifiable');
  if (unverifiable.length > 0) {
    return { kind: 'unverifiable', text: `forge merge evidence unavailable: ${unverifiable.map((repo) => repo.reason).join('; ')}` };
  }
  if (repos.length === 0) {
    return { kind: 'incomplete', text: 'forge merge incomplete: no repositories resolved' };
  }
  const unlanded = repos.filter((repo) => repo.state === 'unlanded');
  if (unlanded.length > 0) {
    return { kind: 'incomplete', text: `forge merge incomplete: ${unlanded.map((repo) => repo.reason).join('; ')}` };
  }
  const merged = repos.filter((repo) => repo.state === 'merged');
  if (merged.length === 0) {
    return { kind: 'incomplete', text: 'forge merge incomplete: no repository has a merged review artifact' };
  }

  const list = repos.map((repo) => repo.state === 'merged'
    ? (repo.url ? `${repo.repoKey} merged (${repo.url})` : `${repo.repoKey} merged`)
    : `${repo.repoKey} no branch work`).join(', ');
  return { kind: 'complete', text: `forge merge complete: ${list}` };
}

export function memoizeOnce<T>(read: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () => {
    if (!cached) cached = read();
    return cached;
  };
}
