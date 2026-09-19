/**
 * `pan done` — the work agent's one submit step (PAN-3917 FR-10).
 *
 * It opens or updates the pull request for the issue's branches, marks it
 * ready for review, moves the tracker to In Review, and writes nothing else.
 * There is no pipeline record, no review-request row, and no dashboard status
 * post: "this issue is in review" is derived from the PR — open, not a draft —
 * and "this item is done" lives in `.pan/continues/`, written by `pan task`.
 *
 * The pre-flight checks that survive are the ones git and the plan can answer:
 * a clean working tree, a branch that is pushed and ahead of its target, and
 * an xBRIEF whose checklist is complete (item status comes from the continue
 * file through `readWorkspacePlan`).
 */

import { exec, execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

import chalk from 'chalk';
import { Effect } from 'effect';
import ora from 'ora';

import { exitCli } from '../exit.js';
import { emitActivityEntrySync, emitActivityTtsSync } from '../../lib/activity-logger.js';
import { cleanupWorkflowLabels } from '../../core/state-mapping.js';
import { getForgeAdapter } from '../../lib/forge.js';
import { extractNumberSync, resolveIssueIdSync } from '../../lib/issue-id.js';
import { findWorkspacePath } from '../../lib/lifecycle/archive-planning.js';
import { buildMergeSetForIssueSync } from '../../lib/merge-set.js';
import { resolvePlanHome } from '../../lib/pan-dir/paths.js';
import { computeWorkspaceRepoRootsSync, resolveProjectReposForIssueSync } from '../../lib/project-repos.js';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import { getLinearApiKey } from '../../lib/shadow-utils.js';
import { runPreflightChecks } from '../../lib/work/done-preflight.js';
import { updateContinueState } from '../../lib/xbrief/continue-state.js';
import { commitPlanArtifacts, planArtifactCommitMessage } from '../../lib/overdeck/plan-artifact-commit.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

interface DoneOptions {
  comment?: string;
  force?: boolean;
  testWaived?: string;
  /**
   * Strike shape: the strike already merged to main, so there is no PR to open
   * and no review to request. `pan done --strike` only proves the strike branch
   * is contained in `origin/main`.
   */
  strike?: boolean;
}

// ─── Tracker ─────────────────────────────────────────────────────────────────

async function updateLinearToInReview(apiKey: string, issueIdentifier: string, comment?: string): Promise<boolean> {
  try {
    const { LinearClient } = await import('@linear/sdk');
    const client = new LinearClient({ apiKey });
    const searchResults = await client.searchIssues(issueIdentifier, { first: 1 });
    const searchHit = searchResults.nodes.find(
      (i) => i.identifier.toUpperCase() === issueIdentifier.toUpperCase(),
    );
    if (!searchHit) return false;

    const issue = await client.issue(searchHit.id);
    const { findLinearStateByName, getLinearStateName } = await import('../../core/state-mapping.js');
    const team = await issue.team;
    if (!team) return false;
    const states = await team.states();
    const target = findLinearStateByName(states.nodes, getLinearStateName('in_review'));
    if (!target) return false;

    await issue.update({ stateId: target.id });
    if (comment) await client.createComment({ issueId: issue.id, body: `🤖 **Agent completed work:**\n\n${comment}` });
    return true;
  } catch (error) {
    console.error('Linear API error:', error);
    return false;
  }
}

function getGitHubConfig(): { token: string; repos: { owner: string; repo: string; prefix: string }[] } | null {
  const envFile = join(homedir(), '.overdeck.env');
  if (!existsSync(envFile)) return null;
  const content = readFileSync(envFile, 'utf-8');
  const tokenMatch = content.match(/GITHUB_TOKEN=(.+)/);
  if (!tokenMatch) return null;
  const reposMatch = content.match(/GITHUB_REPOS=(.+)/);
  if (!reposMatch) return null;
  const repos = reposMatch[1].trim().split(',').map((r) => {
    const [repoPath, prefix] = r.trim().split(':');
    const [owner, repo] = repoPath.split('/');
    return { owner, repo, prefix };
  }).filter((r) => r.owner && r.repo);
  if (repos.length === 0) return null;
  return { token: tokenMatch[1].trim(), repos };
}

async function updateGitHubToInReview(issueId: string, comment?: string): Promise<boolean> {
  try {
    const ghConfig = getGitHubConfig();
    if (!ghConfig) return false;
    const number = extractNumberSync(issueId);
    if (number === null) return false;
    const { owner, repo } = ghConfig.repos.find((r) => r.prefix === 'PAN') ?? ghConfig.repos[0];
    const headers = {
      Authorization: `token ${ghConfig.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };

    const labelsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`, {
      headers, signal: AbortSignal.timeout(15_000),
    });
    const currentLabels = labelsRes.ok ? (await labelsRes.json() as { name: string }[]).map((l) => l.name) : [];
    if (currentLabels.some((l) => l.toLowerCase() === 'closed-out')) {
      console.error(chalk.red(`\n✖ ${issueId} has already been closed out. Cannot mark work as done.\n`));
      return false;
    }

    await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`, {
      method: 'PUT', headers, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ labels: cleanupWorkflowLabels(currentLabels, 'in_review') }),
    });
    if (comment) {
      await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`, {
        method: 'POST', headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ body: `🤖 **Agent completed work:**\n\n${comment}` }),
      });
    }
    return true;
  } catch (error) {
    console.error('GitHub API error:', error);
    return false;
  }
}

/** Refuse a done on an issue the tracker already closed. */
async function refuseIfIssueClosed(issueId: string): Promise<string | null> {
  const { resolveGitHubIssueSync } = await import('../../lib/tracker-utils.js');
  const ghInfo = resolveGitHubIssueSync(issueId);
  if (ghInfo.isGitHub) {
    try {
      const { stdout } = await execAsync(
        `gh issue view ${ghInfo.number} --repo ${ghInfo.owner}/${ghInfo.repo} --json state,labels --jq '[.state, (.labels | map(.name) | join(","))] | @tsv'`,
        { encoding: 'utf-8' },
      );
      const [state, labelsStr] = stdout.trim().split('\t');
      if ((state || '').toLowerCase() === 'closed') return `${issueId} is already closed.`;
      if ((labelsStr || '').split(',').some((l) => l.toLowerCase() === 'closed-out')) {
        return `${issueId} has already been closed out.`;
      }
      return null;
    } catch (error) {
      return `Could not verify issue state for ${issueId} (${(error as Error).message}). Use --force to override.`;
    }
  }

  const apiKey = await Effect.runPromise(getLinearApiKey());
  if (!apiKey) return null;
  try {
    const { LinearClient } = await import('@linear/sdk');
    const client = new LinearClient({ apiKey });
    const { extractPrefixSync } = await import('../../lib/issue-id.js');
    const issueNum = extractNumberSync(issueId);
    const teamKey = extractPrefixSync(issueId);
    if (issueNum === null || teamKey === null) return null;
    const results = await client.issues({ filter: { number: { eq: issueNum }, team: { key: { eq: teamKey } } }, first: 1 });
    const state = results.nodes.length > 0 ? await results.nodes[0].state : null;
    return state?.type === 'completed' || state?.type === 'canceled' ? `${issueId} is already closed.` : null;
  } catch (error) {
    return `Could not verify Linear issue state for ${issueId} (${(error as Error).message}). Use --force to override.`;
  }
}

// ─── The PR ──────────────────────────────────────────────────────────────────

/** Acceptance criteria from the plan, so the PR body carries the checklist. */
async function buildPrBody(issueId: string, workspacePath: string): Promise<string> {
  const lines = [`**Issue:** #${extractNumberSync(issueId) ?? issueId}`, ''];
  try {
    const { readWorkspacePlanSync } = await import('../../lib/xbrief/io.js');
    const items = readWorkspacePlanSync(workspacePath)?.plan.items ?? [];
    if (items.length > 0) {
      lines.push('## Acceptance Criteria', '');
      for (const item of items) lines.push(`- [${item.status === 'completed' ? 'x' : ' '}] ${item.title}`);
      lines.push('');
    }
  } catch { /* body enrichment only */ }
  return lines.join('\n').trim() || `Automated review artifact for ${issueId}`;
}

export interface OpenedPr {
  repoKey: string;
  url?: string;
  id?: string;
  created: boolean;
}

/** True when the repo checkout has commits the target branch does not. */
async function repoHasChanges(dir: string, targetBranch: string): Promise<boolean> {
  if (!existsSync(join(dir, '.git'))) return false;
  await execFileAsync('git', ['fetch', 'origin', targetBranch], { cwd: dir, timeout: 30_000 }).catch(() => {});
  try {
    await execFileAsync('git', ['diff', '--quiet', `origin/${targetBranch}...HEAD`], { cwd: dir, timeout: 15_000 });
    return false;
  } catch {
    return true;
  }
}

/**
 * Open the PR for every repo with changes, or return the one already open.
 * The forge adapter is the GitHub (`gh`) and GitLab (`glab`) door; nothing
 * about the result is stored.
 */
export async function openOrUpdatePullRequests(issueId: string, workspacePath: string): Promise<OpenedPr[]> {
  const repos = resolveProjectReposForIssueSync(issueId);
  const roots = computeWorkspaceRepoRootsSync(repos, issueId, workspacePath);
  const forgeByKey = new Map((repos ?? []).map((repo) => [repo.repoKey, repo.forge]));
  const body = await buildPrBody(issueId, workspacePath);
  const opened: OpenedPr[] = [];

  for (const root of roots) {
    if (!(await repoHasChanges(root.dir, root.targetBranch))) continue;
    const adapter = getForgeAdapter(forgeByKey.get(root.repoKey) ?? 'github');
    const artifact = await adapter.createReviewArtifact({
      title: issueId,
      body,
      sourceBranch: root.sourceBranch,
      targetBranch: root.targetBranch,
      cwd: root.dir,
    });
    opened.push({ repoKey: root.repoKey, url: artifact.url, id: artifact.id, created: artifact.created });

    // "Review requested" is derived from the PR being open and not a draft —
    // there is no reviewer row to write. `gh pr ready` is a no-op on a PR that
    // is already ready.
    if (adapter.forge === 'github' && artifact.url) {
      await execFileAsync('gh', ['pr', 'ready', artifact.url], { cwd: root.dir }).catch(() => {});
    }
  }
  return opened;
}

/** The test-gate waiver is a decision on the issue's continue file, not a record. */
export async function recordTestWaiver(workspacePath: string, reason: string): Promise<void> {
  const issueId = workspacePath.match(/feature-([a-z]+-\d+)$/i)?.[1]?.toUpperCase();
  if (!issueId) return;
  const planHome = resolvePlanHome(workspacePath);
  updateContinueState(planHome, issueId, (state) => ({
    ...state,
    decisions: [
      ...state.decisions,
      { id: 'D-test-waived', summary: `Test gate waived: ${reason}`, recordedAt: new Date().toISOString() },
    ],
  }));
  await commitPlanArtifacts({
    cwd: planHome,
    paths: [join('.pan', 'continues')],
    message: planArtifactCommitMessage(issueId),
  });
}

export function augmentCommentWithWaiver(comment: string | undefined, waiverReason: string): string {
  const waiverText = `Test gate waived: ${waiverReason}`;
  return comment ? `${comment}\n\n${waiverText}` : waiverText;
}

// ─── The verb ────────────────────────────────────────────────────────────────

export async function doneCommand(id: string, options: DoneOptions = {}): Promise<void> {
  const issueId = resolveIssueIdSync(id);

  if (options.strike) {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved?.projectPath) {
      console.error(chalk.red(`Could not resolve project for ${issueId}.`));
      return exitCli(1);
    }
    const { verifyStrikeBranchMergedIntoMain } = await import('./strike-merge-verification.js');
    try {
      const reason = await verifyStrikeBranchMergedIntoMain(issueId, resolved.projectPath);
      console.log(chalk.green(`✓ Verified strike merge: ${reason}`));
    } catch (error) {
      console.error(chalk.red(`Strike ${issueId} is not contained in origin/main: ${(error as Error).message}`));
      return exitCli(1);
    }
    emitActivityEntrySync({
      source: 'strike',
      level: 'info',
      issueId,
      message: `Strike ${issueId} merged to main${options.comment ? `: ${options.comment}` : ''}`,
    });
    return;
  }

  if (!options.force) {
    const refusal = await refuseIfIssueClosed(issueId);
    if (refusal) {
      console.error(chalk.red(`\n✖ ${refusal}\n`));
      return exitCli(1);
    }
  }

  const resolved = resolveProjectFromIssueSync(issueId);
  const workspacePath = resolved ? findWorkspacePath(resolved.projectPath, issueId.toLowerCase()) : null;
  if (!workspacePath || !existsSync(workspacePath)) {
    console.error(chalk.red(`Workspace not found for ${issueId}; there is nothing to open a pull request from.`));
    return exitCli(1);
  }

  if (!options.force) {
    const failures = await Effect.runPromise(runPreflightChecks(workspacePath, issueId, options.testWaived));
    if (failures.length > 0) {
      console.error(chalk.red(`\n✖ Work completion checks failed for ${issueId}:\n`));
      for (const line of failures) console.error(line);
      console.error('');
      console.error(chalk.dim('  Resolve uncommitted changes by picking ONE:'));
      console.error(chalk.dim('    1. Commit:  git add -A && git commit -m "<message>" (in the repo that owns the file)'));
      console.error(chalk.dim('    2. Discard: git restore --staged --worktree . (tracked files only; destructive)'));
      console.error(chalk.dim(`    3. Surface: pan tell ${issueId} "Uncommitted changes need operator decision"`));
      console.error('');
      console.error(chalk.dim(`  After resolving, run 'pan done ${issueId}' again.`));
      console.error(chalk.dim('  Use --force to skip checks (NOT recommended — leaves uncommitted work behind).'));
      console.error('');
      return exitCli(1);
    }

    if (options.testWaived) {
      await recordTestWaiver(workspacePath, options.testWaived);
      options.comment = augmentCommentWithWaiver(options.comment, options.testWaived);
    }
  }

  const spinner = ora('Marking work as done...').start();

  try {
    // Step 1: rebase onto the target branch and push. `pan done` is one command
    // for the agent; the fetch/rebase/push it used to do by hand lives here.
    const mergeSet = buildMergeSetForIssueSync(issueId);
    if (mergeSet && mergeSet.repos.length > 0) {
      const { rebaseAndPushRepos } = await import('../../lib/rebase-helper.js');
      spinner.text = 'Rebasing onto target branch and pushing...';
      const rebaseResult = await Effect.runPromise(rebaseAndPushRepos(workspacePath, mergeSet));
      if (!rebaseResult.success) {
        const failure = rebaseResult.firstFailure!;
        spinner.fail(`Rebase failed in ${failure.repoKey}`);
        console.error('');
        if (failure.conflictFiles?.length) {
          console.error(chalk.red('Rebase conflicts in non-planning files:'));
          for (const file of failure.conflictFiles) console.error(chalk.red(`  - ${file}`));
          console.error('');
          console.error(chalk.dim(`Resolve the conflicts manually, commit, then re-run: pan done ${issueId}`));
        } else {
          console.error(chalk.red(failure.message || 'Unknown rebase error'));
        }
        console.error('');
        return exitCli(1);
      }
      const rebased = rebaseResult.results.filter((r) => r.outcome === 'rebased');
      console.log(rebased.length > 0
        ? chalk.green(`  ✓ Rebased and pushed ${rebased.length} repo(s)`)
        : chalk.dim('  Branch already current with target — pushed any local commits'));
    }

    // Step 2: open or update the PR, and mark it ready for review.
    spinner.text = 'Opening the pull request...';
    const opened = await openOrUpdatePullRequests(issueId, workspacePath);
    if (opened.length === 0) {
      spinner.fail(`No repo under ${issueId}'s workspace has commits the target branch does not.`);
      console.error(chalk.dim('  Commit and push the work, then run pan done again.'));
      return exitCli(1);
    }
    for (const pr of opened) {
      console.log(chalk.green(`  ✓ ${pr.created ? 'Opened' : 'Updated'} ${pr.repoKey}: ${pr.url ?? '(no url)'}`));
    }

    // Step 3: move the tracker to In Review.
    spinner.text = 'Updating the tracker...';
    const trackerUpdated = issueId.startsWith('PAN-')
      ? await updateGitHubToInReview(issueId, options.comment)
      : await (async () => {
        const apiKey = await Effect.runPromise(getLinearApiKey());
        return apiKey ? updateLinearToInReview(apiKey, issueId, options.comment) : false;
      })();
    console.log(trackerUpdated
      ? chalk.green(`  ✓ Updated ${issueId} to In Review`)
      : chalk.yellow('  ⚠ Tracker not updated'));

    spinner.succeed(`Work complete: ${issueId}`);
    emitActivityEntrySync({
      source: 'work-agent',
      level: 'info',
      message: `${issueId} work complete — pull request open for review`,
      issueId,
    });
    emitActivityTtsSync({
      utterance: `Work agent finished ${issueId}, entering review`,
      priority: 2,
      issueId,
      source: 'work-agent',
      eventType: 'workAgent.finished',
    });

    console.log('');
    console.log(chalk.bold('Summary:'));
    console.log(`  Issue:   ${chalk.cyan(issueId)}`);
    console.log(`  PR:      ${chalk.cyan(opened.map((pr) => pr.url).filter(Boolean).join(', ') || 'unknown')}`);
    console.log(`  Tracker: ${trackerUpdated ? chalk.green('In Review') : chalk.dim('Not updated')}`);
    if (options.comment) {
      console.log(`  Comment: ${chalk.dim(options.comment.slice(0, 50))}${options.comment.length > 50 ? '...' : ''}`);
    }
    console.log('');
    console.log(chalk.dim('Ready for review. Review state is read from the PR.'));
    console.log('');
  } catch (error) {
    spinner.fail((error as Error).message);
    return exitCli(1);
  }
}
