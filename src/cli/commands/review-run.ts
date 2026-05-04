/**
 * `pan review run <issueId>` — blocking orchestrator for a code review.
 *
 * Spawns reviewer tmux sessions, waits for all reviewer outputs, spawns the
 * synthesis session, waits for it, posts the GitHub PR review, and exits with
 * a status code reflecting the verdict:
 *
 *   0 = approved
 *   1 = changes_requested
 *   2 = failed (reviewer crashed / timed out / synthesis missing)
 *
 * This command runs inside the work agent's tmux session (or any caller's
 * shell), NOT the dashboard server. That is the whole point: orchestration
 * lives in this blocking invocation, so dashboard restarts are invisible to
 * in-flight reviews. See docs/REVIEW-AGENT-ARCHITECTURE.md.
 */

import chalk from 'chalk';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, join } from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import {
  runParallelReview,
  getReviewAgents,
  reviewResultToReviewStatus,
  type ReviewContext,
} from '../../lib/cloister/review-agent.js';
import { setReviewStatus } from '../../lib/review-status.js';
import { findProjectByPath } from '../../lib/projects.js';

const execAsync = promisify(exec);

interface ReviewRunOptions {
  cwd?: string;
  prUrl?: string;
  branch?: string;
  filesChanged?: string;
  model?: string;
}

function resolvePolyrepoGitDirs(workspacePath: string): string[] {
  const gitDirs: string[] = [];
  try {
    const entries = readdirSync(workspacePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && existsSync(join(workspacePath, entry.name, '.git'))) {
        gitDirs.push(join(workspacePath, entry.name));
      }
    }
  } catch {}
  return gitDirs;
}

async function detectPrUrlForRepo(repoDir: string): Promise<string | null> {
  // Try GitHub
  try {
    const { stdout } = await execAsync('gh pr view --json url -q .url', { cwd: repoDir });
    if (stdout.trim()) return stdout.trim();
  } catch {}

  // Try GitLab
  try {
    const { stdout } = await execAsync("glab mr view --output json | jq -r '.web_url'", { cwd: repoDir });
    if (stdout.trim() && stdout.trim() !== 'null') return stdout.trim();
  } catch {}

  return null;
}

export async function reviewRunCommand(
  id: string,
  opts: ReviewRunOptions = {},
): Promise<void> {
  const issueId = id.toUpperCase();
  if (opts.model) {
    process.env.PANOPTICON_REVIEW_MODEL_OVERRIDE = opts.model;
  }
  const cwd = opts.cwd ?? process.cwd();
  const projectConfig = findProjectByPath(cwd);
  const isPolyrepo = projectConfig?.workspace?.type === 'polyrepo';

  console.log(chalk.cyan(`\n▶ pan review run ${issueId}`));
  console.log(chalk.dim(`  workspace: ${cwd}`));
  if (isPolyrepo) console.log(chalk.dim(`  type:      polyrepo`));

  let branch: string | null;
  let prUrl: string | null;
  let filesChanged: string[];

  if (isPolyrepo) {
    const gitDirs = resolvePolyrepoGitDirs(cwd);
    if (gitDirs.length === 0) {
      console.error(chalk.red('\nError: polyrepo workspace has no code repos with .git'));
      process.exit(2);
    }

    branch = opts.branch ?? (await detectBranch(gitDirs[0]));
    if (!branch) {
      console.error(chalk.red('\nError: could not detect git branch from code repos.'));
      process.exit(2);
    }
    console.log(chalk.dim(`  branch:    ${branch}`));

    prUrl = opts.prUrl ?? null;
    if (!prUrl) {
      for (const dir of gitDirs) {
        prUrl = await detectPrUrlForRepo(dir);
        if (prUrl) break;
      }
    }
    if (!prUrl) {
      console.error(chalk.red('\nError: could not detect PR/MR URL from any code repo.'));
      console.error(chalk.dim('Open a PR/MR first, then retry.'));
      process.exit(2);
    }
    console.log(chalk.dim(`  PR:        ${prUrl}`));

    if (opts.filesChanged) {
      filesChanged = opts.filesChanged.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      filesChanged = [];
      for (const dir of gitDirs) {
        const repoFiles = await detectFilesChanged(dir);
        const repoName = basename(dir);
        filesChanged.push(...repoFiles.map(f => `${repoName}/${f}`));
      }
    }
    console.log(chalk.dim(`  files:     ${filesChanged.length} changed across ${gitDirs.length} repos`));
  } else {
    if (!existsSync(join(cwd, '.git'))) {
      console.error(chalk.red(`\nError: ${cwd} is not a git repo.`));
      console.error(chalk.dim('`pan review run` must be invoked inside the workspace directory.'));
      process.exit(2);
    }

    branch = opts.branch ?? (await detectBranch(cwd));
    if (!branch) {
      console.error(chalk.red('\nError: could not detect current git branch.'));
      process.exit(2);
    }
    console.log(chalk.dim(`  branch:    ${branch}`));

    prUrl = opts.prUrl ?? (await detectPrUrl(cwd));
    if (!prUrl) {
      console.error(chalk.red('\nError: could not detect PR URL for the current branch.'));
      console.error(chalk.dim('Open a PR first (gh pr create), then retry.'));
      process.exit(2);
    }
    console.log(chalk.dim(`  PR:        ${prUrl}`));

    filesChanged = opts.filesChanged
      ? opts.filesChanged.split(',').map(s => s.trim()).filter(Boolean)
      : await detectFilesChanged(cwd);
    console.log(chalk.dim(`  files:     ${filesChanged.length} changed`));
  }

  const agents = getReviewAgents();
  console.log(chalk.dim(`  reviewers: ${agents.map(a => a.name).join(', ')}`));

  const context: ReviewContext = {
    projectPath: cwd,
    prUrl,
    issueId,
    branch,
    filesChanged,
  };

  // Mark reviewing in the review-status DB so the dashboard reflects the
  // in-flight state even if the server is restarted mid-review. Safe against
  // the coordinator-dispatch path: setReviewStatus is idempotent and that
  // path has already written 'reviewing' upfront.
  try {
    setReviewStatus(issueId, {
      reviewStatus: 'reviewing',
      reviewSpawnedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn(chalk.yellow(`[review-run] setReviewStatus(reviewing) failed (continuing): ${err instanceof Error ? err.message : String(err)}`));
  }

  console.log(chalk.cyan('\nPhase 1/4: spawning reviewers...'));
  console.log(chalk.cyan('Phase 2/4: waiting for reviewer outputs...'));
  console.log(chalk.cyan('Phase 3/4: synthesizing...'));
  console.log(chalk.cyan('Phase 4/4: posting to GitHub...'));
  console.log('');

  const { result, reviewId } = await runParallelReview(context, filesChanged, agents);

  console.log('');
  console.log(chalk.dim(`Review ID:  ${reviewId}`));
  console.log(chalk.dim(`Outputs:    ${join(cwd, '.pan', 'review', reviewId)}`));

  const synthJsonPath = join(cwd, '.pan', 'review', reviewId, 'synthesis.json');
  let verdict: string | undefined;
  let blockerCount: number | undefined;
  if (existsSync(synthJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(synthJsonPath, 'utf-8')) as {
        verdict?: string;
        blockerCount?: number;
      };
      verdict = parsed.verdict;
      blockerCount = parsed.blockerCount;
    } catch {
      /* fall through to parseReviewSynthesis result */
    }
  }

  const exitCode = mapToExitCode(result.reviewResult, verdict, result.success);

  // Persist the terminal review status. The dashboard reads this from the DB
  // on next observation — no server API needed.
  try {
    const mapped = reviewResultToReviewStatus(result);
    setReviewStatus(issueId, {
      reviewStatus: mapped,
      reviewNotes: result.notes,
      reviewRetryCount: 0,
      recoveryStartedAt: undefined,
    });
  } catch (err) {
    console.warn(chalk.yellow(`[review-run] setReviewStatus(terminal) failed: ${err instanceof Error ? err.message : String(err)}`));
  }

  if (exitCode === 0) {
    console.log(chalk.green(`\n✓ Verdict: APPROVED`));
  } else if (exitCode === 1) {
    const bc = blockerCount !== undefined ? ` (${blockerCount} blocker${blockerCount === 1 ? '' : 's'})` : '';
    console.log(chalk.yellow(`\n⚠ Verdict: CHANGES_REQUESTED${bc}`));
    if (result.notes) console.log(chalk.dim(`\n${result.notes}`));
    console.log(chalk.dim(`\nRead the synthesis: ${join(cwd, '.pan', 'review', reviewId, 'synthesis.md')}`));
  } else {
    console.log(chalk.red(`\n✗ Verdict: FAILED`));
    if (result.notes) console.log(chalk.dim(`\n${result.notes}`));
  }

  process.exit(exitCode);
}

async function detectBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git branch --show-current', { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function detectPrUrl(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('gh pr view --json url -q .url', { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function detectFilesChanged(cwd: string): Promise<string[]> {
  try {
    // Diff against the merge-base with origin/main — typical feature-branch flow.
    const { stdout: base } = await execAsync(
      'git merge-base HEAD origin/main',
      { cwd },
    ).catch(() => ({ stdout: '' }));
    const mergeBase = base.trim();
    if (!mergeBase) {
      // Fallback: any uncommitted changes + last commit
      const { stdout } = await execAsync('git diff --name-only HEAD~1', { cwd });
      return stdout.split('\n').map(s => s.trim()).filter(Boolean);
    }
    const { stdout } = await execAsync(
      `git diff --name-only ${mergeBase}..HEAD`,
      { cwd },
    );
    return stdout.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function mapToExitCode(
  reviewResult: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED',
  verdictJson?: string,
  success?: boolean,
): 0 | 1 | 2 {
  // synthesis.json is authoritative when present — it's the new contract.
  if (verdictJson === 'approved') return 0;
  if (verdictJson === 'changes_requested') return 1;
  if (verdictJson === 'failed') return 2;

  // Fallback to the legacy REVIEW_RESULT tail marker parser.
  if (reviewResult === 'APPROVED') return 0;
  if (reviewResult === 'CHANGES_REQUESTED') return 1;
  // PAN-869: COMMENTED with success=true means review completed with no blockers
  if (reviewResult === 'COMMENTED' && success) return 0;
  return 2;
}
