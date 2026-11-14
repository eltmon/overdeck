import { exec } from 'child_process';
import { promisify } from 'util';
import { stepOk, stepSkipped, stepFailed, type LifecycleContext, type StepResult } from './types.js';
import { getForgeAdapter } from '../forge.js';
import { resolveProjectReposForIssue } from '../project-repos.js';
import { BRANCH_ABSENT_MERGE_ERROR } from './dod.js';

const execAsync = promisify(exec);

export interface MergeVerificationRoot { repoKey: string; dir: string; sourceBranch: string; targetBranch: string; forge: 'github' | 'gitlab'; comparison?: TargetComparison }

/** The ref the merged check compares against, and why when it is not origin/<target>. */
export type TargetComparison =
  | { ref: string; note?: string }
  | { ref: null; error: string };

function fetchFailureReason(err: unknown): string {
  const e = err as { stderr?: unknown; message?: unknown } | null | undefined;
  for (const candidate of [e?.stderr, e?.message, err]) {
    const text = typeof candidate === 'string' ? candidate : candidate == null ? '' : String(candidate);
    const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
    if (line) return line.slice(0, 200);
  }
  return String(err).slice(0, 200);
}

export async function resolveTargetComparison(dir: string, targetBranch: string): Promise<TargetComparison> {
  try {
    await execAsync(
      `git fetch origin +refs/heads/${targetBranch}:refs/remotes/origin/${targetBranch}`,
      { cwd: dir, encoding: 'utf-8', timeout: 30000 },
    );
    return { ref: `origin/${targetBranch}` };
  } catch (err) {
    const reason = fetchFailureReason(err);
    try {
      await execAsync(`git rev-parse --verify --quiet refs/heads/${targetBranch}^{commit}`, { cwd: dir, encoding: 'utf-8' });
    } catch {
      return { ref: null, error: `Cannot verify merge: git fetch origin ${targetBranch} failed (${reason}) and no local ${targetBranch} branch exists` };
    }
    return { ref: targetBranch, note: `Checked against local ${targetBranch} because git fetch origin ${targetBranch} failed: ${reason}` };
  }
}

function withComparisonNote(result: StepResult | null, note: string | undefined): StepResult | null {
  if (!result || !note) return result;
  if (result.success || result.skipped) {
    return { ...result, details: [...(result.details ?? []), note] };
  }
  return { ...result, error: `${result.error} (${note})` };
}

async function verifyRootConventionBranches(ctx: LifecycleContext, root: MergeVerificationRoot, issueLower: string): Promise<StepResult | null> {
  const comparison = root.comparison ?? await resolveTargetComparison(root.dir, root.targetBranch);
  const featureResult = await verifyConventionBranchMerged(ctx, { ...root, comparison });
  if (featureResult?.success) return featureResult;

  const strikeResult = await verifyConventionBranchMerged(ctx, { ...root, sourceBranch: `strike/${issueLower}`, comparison });
  if (strikeResult?.success && !strikeResult.skipped) {
    return stepOk('close-out:verify-merged', [
      ...(strikeResult.details ?? []),
      `Superseded ${root.sourceBranch} residual: ${featureResult?.error ?? BRANCH_ABSENT_MERGE_ERROR}`,
    ]);
  }
  return featureResult;
}

export async function verifyBranchMergedImpl(ctx: LifecycleContext): Promise<StepResult> {
  const step = 'close-out:verify-merged';
  const issueLower = ctx.issueId.toLowerCase();
  const defaultRoot: MergeVerificationRoot = { repoKey: issueLower, dir: ctx.projectPath, sourceBranch: `feature/${issueLower}`, targetBranch: 'main', forge: 'github' };

  try {
    // The forge owns "merged": ask it before falling back to git ancestry.
    try {
      const { fetchIssuePullRequest } = await import('../overdeck/pull-requests.js');
      const response = await fetchIssuePullRequest(ctx.issueId);
      if (response.pr?.mergedAt) {
        return stepOk(step, [`Pull request #${response.pr.number} merged at ${response.pr.mergedAt}`]);
      }
    } catch {
      // Forge unreachable — continue with the local git ancestry checks below.
    }

    const resolvedRoots = resolveProjectReposForIssue(ctx.issueId)
      ?.filter((repo) => repo.required)
      .map((repo): MergeVerificationRoot => ({
        repoKey: repo.repoKey,
        dir: repo.repoPath,
        sourceBranch: repo.sourceBranch,
        targetBranch: repo.targetBranch,
        forge: repo.forge,
      }));
    const roots = resolvedRoots?.length ? resolvedRoots : [defaultRoot];
    if (roots.length === 1) {
      return await verifyRootConventionBranches(ctx, roots[0], issueLower)
        ?? stepFailed(step, BRANCH_ABSENT_MERGE_ERROR);
    }

    const results = await Promise.all(roots.map(async (root) => ({
      root,
      result: await verifyRootConventionBranches(ctx, root, issueLower),
    })));
    const failures = results.filter(({ result }) => result && !result.success);
    if (failures.length > 0) {
      return stepFailed(step, failures.map(({ root, result }) => `${root.repoKey}: ${result?.error}`).join('; '));
    }
    const successes = results.filter(({ result }) => result?.success);
    if (successes.length > 0) {
      return stepOk(step, successes.flatMap(({ root, result }) =>
        (result?.details ?? []).map((detail) => `${root.repoKey}: ${detail}`)));
    }
    return stepFailed(step, BRANCH_ABSENT_MERGE_ERROR);
  } catch (err) {
    return stepFailed(step, `Could not verify merge: ${(err as Error).message}`);
  }
}

interface GitLabMergeLookupCache {
  attempted: boolean;
  headSha?: string;
  artifact?: { id?: string; url?: string } | null;
}

interface GitLabMergeMatch {
  result: StepResult;
  reused: boolean;
}

export async function verifyConventionBranchMerged(ctx: LifecycleContext, root: MergeVerificationRoot): Promise<StepResult | null> {
  const comparison = root.comparison ?? await resolveTargetComparison(root.dir, root.targetBranch);
  if (comparison.ref === null) return stepFailed('close-out:verify-merged', comparison.error);
  const result = await verifyConventionBranchAgainst(ctx, root, comparison);
  return withComparisonNote(result, comparison.note);
}

async function verifyConventionBranchAgainst(
  ctx: LifecycleContext,
  root: MergeVerificationRoot,
  comparison: { ref: string },
): Promise<StepResult | null> {
  const step = 'close-out:verify-merged';
  const gitlabLookup: GitLabMergeLookupCache = { attempted: false };
  const { stdout: branchExists } = await execAsync(
    `git branch --list "${root.sourceBranch}" 2>/dev/null || true`,
    { cwd: root.dir, encoding: 'utf-8' },
  );

  if (branchExists.trim()) {
    // Use merge-base --is-ancestor: checks if the branch tip is reachable from main
    try {
      await execAsync(
        `git merge-base --is-ancestor ${root.sourceBranch} ${comparison.ref}`,
        { cwd: root.dir, encoding: 'utf-8' },
      );
      const remoteCheck = await verifyRemoteBranchIfPresent(ctx, root, comparison, gitlabLookup);
      if (remoteCheck && !remoteCheck.success) return remoteCheck;
      return stepOk(step, ['All commits merged to main', ...(remoteCheck?.details ?? [])]);
    } catch {
      // --is-ancestor fails for squash merges where the branch still exists.
      const gitlabMerged = await verifySquashMergedMrByBranch(root, root.sourceBranch, gitlabLookup);
      if (gitlabMerged) {
        const remoteCheck = await verifyRemoteBranchIfPresent(ctx, root, comparison, gitlabLookup);
        if (remoteCheck && !remoteCheck.success) return remoteCheck;
        return stepOk(step, [...(gitlabMerged.result.details ?? []), ...(remoteCheck?.details ?? [])]);
      }

      try {
        const { stdout: codeDiff } = await execAsync(
          `git diff ${comparison.ref}...${root.sourceBranch} -- ':!.planning' ':!docs/prds' ':!.overdeck/prompts' 2>/dev/null || true`,
          { cwd: root.dir, encoding: 'utf-8' },
        );
        if (!codeDiff.trim()) {
          const remoteCheck = await verifyRemoteBranchIfPresent(ctx, root, comparison, gitlabLookup);
          if (remoteCheck && !remoteCheck.success) return remoteCheck;
          return stepOk(step, [
            'Code changes squash-merged to main (only planning artifacts remain on branch)',
            ...(remoteCheck?.details ?? []),
          ]);
        }
      } catch {
        // diff failed — fall through to unmerged report
      }

      const githubMerged = root.forge === 'github'
        ? await verifySquashMergedPrByBranch(ctx, root, root.sourceBranch, comparison)
        : null;
      if (githubMerged?.success) {
        const remoteCheck = await verifyRemoteBranchIfPresent(ctx, root, comparison, gitlabLookup);
        if (remoteCheck && !remoteCheck.success) return remoteCheck;
        return stepOk(step, [
          ...(githubMerged.details ?? []),
          ...(remoteCheck?.details ?? []),
        ]);
      }
      if (githubMerged) return githubMerged;

      const { stdout: unmerged } = await execAsync(
        `git log ${comparison.ref}..${root.sourceBranch} --oneline 2>/dev/null || true`,
        { cwd: root.dir, encoding: 'utf-8' },
      );
      const count = unmerged.trim() ? unmerged.trim().split('\n').length : 0;

      if (ctx.github && root.forge === 'github') {
        try {
          const { stdout: issueState } = await execAsync(
            `gh issue view ${ctx.github.number} --repo ${ctx.github.owner}/${ctx.github.repo} --json state --jq '.state'`,
            { cwd: root.dir, encoding: 'utf-8' },
          );
          if (issueState.trim().toUpperCase() === 'CLOSED') {
            return stepSkipped(step, [`Issue already closed on GitHub; ${count} unmerged commit(s) remain on ${root.sourceBranch}`]);
          }
        } catch {
          // gh check failed — fall through to hard fail
        }
      }

      return stepFailed(step, `${count} unmerged commit(s) on ${root.sourceBranch}. Merge before closing out.`);
    }
  }

  // Check remote
  const { stdout: remoteBranch } = await execAsync(
    `git ls-remote --heads origin "${root.sourceBranch}" 2>/dev/null || true`,
    { cwd: root.dir, encoding: 'utf-8' },
  );

  if (remoteBranch.trim()) {
    await execAsync(`git fetch origin ${root.sourceBranch}`, { cwd: root.dir }).catch(() => {});
    const remoteCheck = await verifyRemoteBranchIfPresent(ctx, root, comparison, gitlabLookup);
    if (remoteCheck) return remoteCheck;
  }

  return null;
}

async function verifySquashMergedMrByBranch(
  root: MergeVerificationRoot,
  branchRef: string,
  lookup: GitLabMergeLookupCache,
): Promise<GitLabMergeMatch | null> {
  if (root.forge !== 'gitlab') return null;
  try {
    const { stdout } = await execAsync(`git rev-parse ${branchRef} 2>/dev/null`, { cwd: root.dir, encoding: 'utf-8' });
    const headSha = stdout.trim();
    if (!headSha) return null;
    const reused = lookup.attempted;
    if (!reused) {
      lookup.attempted = true;
      lookup.headSha = headSha;
      lookup.artifact = await getForgeAdapter('gitlab').findMergedArtifact({
        sourceBranch: root.sourceBranch,
        targetBranch: root.targetBranch,
        headSha,
        cwd: root.dir,
      });
    }
    if (!lookup.artifact || lookup.headSha !== headSha) return null;
    const label = lookup.artifact.id ? `MR !${lookup.artifact.id}` : 'GitLab MR';
    const url = lookup.artifact.url ? ` (${lookup.artifact.url})` : '';
    return {
      result: stepOk('close-out:verify-merged', [`${label} is merged and ${branchRef} matches the merged MR head${url}`]),
      reused,
    };
  } catch {
    return null;
  }
}

type GitHubMergedPr = {
  number?: number;
  mergedAt?: string | null;
  headRefOid?: string | null;
  url?: string | null;
};

async function verifyRemoteBranchIfPresent(
  ctx: LifecycleContext,
  root: MergeVerificationRoot,
  comparison: { ref: string },
  gitlabLookup: GitLabMergeLookupCache,
): Promise<StepResult | null> {
  const step = 'close-out:verify-merged';
  const remoteRef = `origin/${root.sourceBranch}`;

  const { stdout: remoteBranch } = await execAsync(
    `git ls-remote --heads origin "${root.sourceBranch}" 2>/dev/null || true`,
    { cwd: root.dir, encoding: 'utf-8' },
  );
  if (!remoteBranch.trim()) return null;

  await execAsync(`git fetch origin ${root.sourceBranch}`, { cwd: root.dir }).catch(() => {});

  try {
    await execAsync(
      `git merge-base --is-ancestor ${remoteRef} ${comparison.ref}`,
      { cwd: root.dir, encoding: 'utf-8' },
    );
    return stepOk(step, ['Remote branch fully merged']);
  } catch {
    // Squash-merge detection for remote branch
    try {
      const { stdout: codeDiff } = await execAsync(
        `git diff ${comparison.ref}...${remoteRef} -- ':!.planning' ':!docs/prds' ':!.overdeck/prompts' 2>/dev/null || true`,
        { cwd: root.dir, encoding: 'utf-8' },
      );
      if (!codeDiff.trim()) {
        return stepOk(step, ['Remote code changes squash-merged to main (only planning artifacts remain on branch)']);
      }
    } catch {
      // diff failed — fall through
    }

    const gitlabMerged = await verifySquashMergedMrByBranch(root, remoteRef, gitlabLookup);
    if (gitlabMerged) {
      return gitlabMerged.reused
        ? stepOk(step, [`Remote ${remoteRef} matches the merged MR head`])
        : gitlabMerged.result;
    }

    const githubMerged = root.forge === 'github'
      ? await verifySquashMergedPrByBranch(ctx, root, remoteRef, comparison)
      : null;
    if (githubMerged) return githubMerged;

    const { stdout: remoteUnmerged } = await execAsync(
      `git log ${comparison.ref}..${remoteRef} --oneline 2>/dev/null || true`,
      { cwd: root.dir, encoding: 'utf-8' },
    );
    const count = remoteUnmerged.trim() ? remoteUnmerged.trim().split('\n').length : 0;

    if (ctx.github && root.forge === 'github') {
      try {
        const { stdout: issueState } = await execAsync(
          `gh issue view ${ctx.github.number} --repo ${ctx.github.owner}/${ctx.github.repo} --json state --jq '.state'`,
          { cwd: root.dir, encoding: 'utf-8' },
        );
        if (issueState.trim().toUpperCase() === 'CLOSED') {
          return stepSkipped(step, [`Issue already closed on GitHub; ${count} unmerged commit(s) remain on remote ${root.sourceBranch}`]);
        }
      } catch {
        // gh check failed — fall through to hard fail
      }
    }

    return stepFailed(step, `${count} unmerged commit(s) on remote ${root.sourceBranch}.`);
  }
}

async function verifySquashMergedPrByBranch(
  ctx: LifecycleContext,
  root: MergeVerificationRoot,
  branchRef: string,
  comparison: { ref: string },
): Promise<StepResult | null> {
  if (!ctx.github) return null;

  const step = 'close-out:verify-merged';
  const { owner, repo } = ctx.github;
  const remoteTargetRef = comparison.ref;

  try {
    const { stdout: prJson } = await execAsync(
      `gh pr list --repo ${owner}/${repo} --state merged --head ${JSON.stringify(root.sourceBranch)} --json number,mergedAt,headRefOid,url`,
      { cwd: root.dir, encoding: 'utf-8' },
    );
    const prs = JSON.parse(prJson) as GitHubMergedPr[];
    const mergedPr = prs
      .filter((pr) => (
        typeof pr.mergedAt === 'string'
        && pr.mergedAt.length > 0
        && typeof pr.headRefOid === 'string'
        && pr.headRefOid.length > 0
      ))
      .sort((a, b) => Date.parse(String(b.mergedAt)) - Date.parse(String(a.mergedAt)))[0];
    if (!mergedPr?.headRefOid) return null;

    const { stdout: tipShaRaw } = await execAsync(
      `git rev-parse ${branchRef} 2>/dev/null`,
      { cwd: root.dir, encoding: 'utf-8' },
    );
    const tipSha = tipShaRaw.trim();
    if (!tipSha) return null;

    if (tipSha === mergedPr.headRefOid) {
      const prLabel = typeof mergedPr.number === 'number' ? `PR #${mergedPr.number}` : 'GitHub PR';
      return stepOk(step, [`${prLabel} is squash-merged and ${branchRef} matches the merged PR head`]);
    }

    // A workspace may merge a newer target branch after its PR head was pushed.
    // Ignore those merge commits and allow close-out when every post-PR commit
    // is already on the configured remote target; only branch-unique work is unsafe.
    let commitsNotOnTarget: string[] | null = null;
    try {
      const { stdout: commitsRaw } = await execAsync(
        `git log --no-merges --format=%H ${mergedPr.headRefOid}..${tipSha}`,
        { cwd: root.dir, encoding: 'utf-8' },
      );
      const commits = commitsRaw.split('\n').map((sha) => sha.trim()).filter(Boolean);
      const unmerged: string[] = [];
      for (const commit of commits) {
        try {
          await execAsync(
            `git merge-base --is-ancestor ${commit} ${remoteTargetRef}`,
            { cwd: root.dir, encoding: 'utf-8' },
          );
        } catch {
          unmerged.push(commit);
        }
      }
      if (unmerged.length === 0) {
        const prLabel = typeof mergedPr.number === 'number' ? `PR #${mergedPr.number}` : 'GitHub PR';
        return stepOk(step, [
          `${prLabel} is squash-merged; all ${commits.length} post-PR non-merge commit(s) on ${branchRef} are already on ${remoteTargetRef}`,
        ]);
      }

      commitsNotOnTarget = unmerged;
    } catch { /* containment check failure falls through to the state-plane policy */ }

    // PAN-2406 / state-plane policy rule 3: commits after the merged head that
    // touch ONLY legacy state-plane paths under .pan/ are pipeline exhaust —
    // e.g. 'chore: record merge status' — and must not block close-out.
    try {
      const { stdout: deltaRaw } = await execAsync(
        `git diff --name-only ${mergedPr.headRefOid}..${tipSha}`,
        { cwd: root.dir, encoding: 'utf-8' },
      );
      let deltaFiles = deltaRaw.split('\n').map((f) => f.trim()).filter(Boolean);
      let statePlaneOnly = deltaFiles.length > 0 && deltaFiles.every((f) =>
        f.startsWith('.pan/'));
      if (!statePlaneOnly) {
        // Branch may have merged its target INTO itself after the PR merged —
        // the two-dot delta then contains target-branch files. Judge only changes
        // UNIQUE to the branch (three-dot vs the remote target): if those are
        // state-plane-only, everything real is already on the target.
        const { stdout: uniqueRaw } = await execAsync(
          `git diff --name-only ${remoteTargetRef}...${tipSha}`,
          { cwd: root.dir, encoding: 'utf-8' },
        );
        deltaFiles = uniqueRaw.split('\n').map((f) => f.trim()).filter(Boolean);
        statePlaneOnly = deltaFiles.every((f) =>
          f.startsWith('.pan/'));
      }
      if (statePlaneOnly) {
        const prLabel = typeof mergedPr.number === 'number' ? `PR #${mergedPr.number}` : 'GitHub PR';
        return stepOk(step, [
          `${prLabel} is squash-merged; ${branchRef} is ahead only by state-plane commits (${deltaFiles.length} file(s): .pan) — accepted per state-plane policy`,
        ]);
      }
    } catch { /* diff failure falls through to the strict rejection below */ }

    const prLabel = typeof mergedPr.number === 'number' ? `PR #${mergedPr.number}` : 'merged GitHub PR';
    if (commitsNotOnTarget) {
      return stepFailed(step, `${branchRef} has ${commitsNotOnTarget.length} commit(s) after merged ${prLabel} that are not on ${remoteTargetRef}: ${commitsNotOnTarget.join(', ')}`);
    }
    return stepFailed(step, `${branchRef} does not match the head commit of merged ${prLabel}; inspect before closing out.`);
  } catch {
    return null;
  }
}
