import { exitCli } from '../exit.js';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, mkdirSync } from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

import { Effect } from 'effect';

import { getAgentRuntimeState, spawnAgent, stopAgent } from '../../lib/agents.js';
import { ACTIVITY_STALLED_MS } from '../../lib/agents/health.js';
import type { ForgeType } from '../../lib/forge.js';
import { forgeFromRemoteUrlSync, getRepoTargetBranch, inferProjectForgeSync } from '../../lib/project-repos.js';
import {
  getProjectSync,
  resolveProjectFromIssueSync,
  type ProjectConfig,
  type ResolvedProject,
} from '../../lib/projects.js';
import { resolveGitHubIssueSync, type IssueResolution } from '../../lib/tracker-utils.js';
import { isHarnessProcessAlive, sessionExists } from '../../lib/tmux.js';
import type { RoleEffort } from '../../lib/config-yaml.js';

const execAsync = promisify(exec);

export interface StrikeOptions {
  model?: string;
  harness?: 'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse';
  effort?: RoleEffort;
  dryRun?: boolean;
}

interface StrikePlan {
  issueId: string;
  workspace: string;
  branch: string;
  sessionName: string;
  projectRoot: string;
  /** The forge that hosts `origin`: it picks `gh pr create` or `glab mr create`. */
  forge: ForgeType;
  /** The branch the strike is cut from and its pull request targets. */
  baseBranch: string;
  /** `owner/repo` (GitHub) or `group/repo` (GitLab) for the forge CLI's repo flag. */
  forgeRepo?: string;
  /**
   * Set only when the issue is tracked in GitHub Issues on the same repo the
   * pull request opens against, so `Closes #<n>` closes exactly this issue.
   */
  closesGithubIssue?: number;
}

/** A plan before the forge and base branch are read from the repository. */
type StrikePlanDraft = Omit<StrikePlan, 'forge' | 'baseBranch' | 'forgeRepo'> & {
  forge: ForgeType | null;
  baseBranch: string | null;
  githubRepo?: string;
  gitlabRepo?: string;
};

interface PlanStrikeDeps {
  resolveProject: (issueId: string) => ResolvedProject | null;
  getProject: (key: string) => ProjectConfig | null;
  resolveGitHubIssue: (issueId: string) => IssueResolution;
}

const defaultPlanStrikeDeps: PlanStrikeDeps = {
  resolveProject: (issueId) => resolveProjectFromIssueSync(issueId),
  getProject: getProjectSync,
  resolveGitHubIssue: resolveGitHubIssueSync,
};

async function registeredWorktreeBranch(projectRoot: string, workspace: string): Promise<string | null | undefined> {
  const { stdout } = await execAsync('git worktree list --porcelain', { cwd: projectRoot });
  let currentPath: string | null = null;
  let foundWorkspace = false;

  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length);
      if (currentPath === workspace) foundWorkspace = true;
      continue;
    }
    if (currentPath === workspace && line.startsWith('branch ')) {
      return line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }

  return foundWorkspace ? null : undefined;
}

/**
 * The GitHub issue number a strike PR may close, or undefined.
 *
 * `resolveGitHubIssueSync` maps a prefix to a repo, not to a tracker: a project
 * with `github_repo` and `tracker: linear` (lexerra) resolves `LEX-12` to
 * `eltmon/lexerra#12`, an unrelated GitHub issue. A closing keyword is only
 * safe when the project's issues live in GitHub Issues (tracker unset or
 * `github`) and the id resolves to the project's own repo.
 */
function closableGithubIssue(config: ProjectConfig | null, github: IssueResolution): number | undefined {
  if (!config?.github_repo || !github.isGitHub) return undefined;
  if (config.tracker !== undefined && config.tracker !== 'github') return undefined;
  if (`${github.owner}/${github.repo}`.toLowerCase() !== config.github_repo.toLowerCase()) return undefined;
  return github.number;
}

/**
 * Resolve the strike workspace path for an issue. Strike workspaces live next
 * to normal feature workspaces but use the suffix `-strike` so they cannot
 * collide with a long-running pipeline workspace for the same issue.
 */
function planStrike(issueId: string, deps: PlanStrikeDeps = defaultPlanStrikeDeps): StrikePlanDraft {
  const normalized = issueId.toLowerCase();
  const project = deps.resolveProject(issueId);
  if (!project) {
    throw new Error(`No Overdeck project is configured for issue prefix in "${issueId}". Add the project to projects.yaml first.`);
  }
  const config = deps.getProject(project.projectKey);
  const workspace = join(project.projectPath, 'workspaces', `feature-${normalized}-strike`);
  const forge = (config ? inferProjectForgeSync(config) : null) ?? (config?.tracker === 'gitlab' ? 'gitlab' : null);
  const hasConfiguredBase = Boolean(config?.workspace?.pr_target || config?.workspace?.default_branch);
  const closesGithubIssue = closableGithubIssue(config, deps.resolveGitHubIssue(issueId));
  return {
    issueId: issueId.toUpperCase(),
    workspace,
    branch: `strike/${normalized}`,
    sessionName: `strike-${normalized}`,
    projectRoot: project.projectPath,
    forge,
    baseBranch: config && hasConfiguredBase ? getRepoTargetBranch(undefined, config) : null,
    ...(config?.github_repo ? { githubRepo: config.github_repo } : {}),
    ...(config?.gitlab_repo ? { gitlabRepo: config.gitlab_repo } : {}),
    ...(closesGithubIssue !== undefined ? { closesGithubIssue } : {}),
  };
}

async function gitOutput(cwd: string, command: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(command, { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Fill what projects.yaml left open from the repository itself: the forge from
 * the `origin` URL, the base branch from `origin/HEAD`. Falls back to GitHub
 * and `main`, the only values the strike path knew before.
 */
async function resolveStrikePlan(
  draft: StrikePlanDraft,
  git: (cwd: string, command: string) => Promise<string | null> = gitOutput,
): Promise<StrikePlan> {
  const forge = draft.forge
    ?? forgeFromRemoteUrlSync(await git(draft.projectRoot, 'git remote get-url origin'))
    ?? 'github';
  const originHead = draft.baseBranch
    ? null
    : await git(draft.projectRoot, 'git symbolic-ref --short refs/remotes/origin/HEAD');
  const baseBranch = draft.baseBranch ?? originHead?.replace(/^origin\//, '') ?? 'main';
  const { closesGithubIssue, githubRepo, gitlabRepo, ...rest } = draft;
  // The repo flag names the forge's own repo; a GitLab origin never takes a
  // GitHub closing keyword.
  const repo = forge === 'gitlab' ? gitlabRepo : githubRepo;
  return {
    ...rest,
    forge,
    baseBranch,
    ...(repo ? { forgeRepo: repo } : {}),
    ...(forge === 'github' && closesGithubIssue !== undefined ? { closesGithubIssue } : {}),
  };
}

/**
 * Create the strike workspace as a git worktree on a new `strike/<id>` branch.
 * If the worktree already exists, reuse it (no-op).
 */
async function ensureStrikeWorktree(plan: StrikePlan): Promise<void> {
  const registeredBranch = await registeredWorktreeBranch(plan.projectRoot, plan.workspace);
  if (registeredBranch === plan.branch) {
    return;
  }
  if (registeredBranch !== undefined) {
    const actual = registeredBranch ?? 'a detached HEAD';
    throw new Error(
      `Strike workspace ${plan.workspace} is registered on ${actual}, expected ${plan.branch}. Refusing to reuse the wrong worktree.`,
    );
  }
  if (existsSync(plan.workspace)) {
    await rm(plan.workspace, { recursive: true, force: true });
  }
  mkdirSync(join(plan.workspace, '..'), { recursive: true });

  // Create the branch from origin/<base> (fetch first to make sure we're current).
  try {
    await execAsync(`git fetch origin ${JSON.stringify(plan.baseBranch)}`, { cwd: plan.projectRoot });
  } catch {
    /* non-fatal — proceed with the last fetched origin/<base> */
  }

  // Worktree add: branch may already exist locally from a prior strike run.
  let branchExists = false;
  try {
    await execAsync(`git show-ref --verify --quiet refs/heads/${plan.branch}`, { cwd: plan.projectRoot });
    branchExists = true;
  } catch {
    branchExists = false;
  }

  if (branchExists) {
    await execAsync(
      `git worktree add ${JSON.stringify(plan.workspace)} ${JSON.stringify(plan.branch)}`,
      { cwd: plan.projectRoot },
    );
  } else {
    await execAsync(
      `git worktree add -b ${JSON.stringify(plan.branch)} ${JSON.stringify(plan.workspace)} ${JSON.stringify(`origin/${plan.baseBranch}`)}`,
      { cwd: plan.projectRoot },
    );
  }
}

/** The forge command that opens the strike's pull (merge) request, as prompt lines. */
function openRequestLines(plan: StrikePlan, issueReference: string): string[] {
  const repoFlag = plan.forgeRepo ? ` --repo ${plan.forgeRepo}` : '';
  if (plan.forge === 'gitlab') {
    return [
      `7. Open a merge request against \`${plan.baseBranch}\` from the strike branch:`,
      '   ```bash',
      `   glab mr create --target-branch ${plan.baseBranch} --source-branch ${plan.branch}${repoFlag} \\`,
      '     --title "<conventional-commit summary of the strike>" \\',
      `     --description "$(cat <<'EOF'`,
      '   <what changed and why, and how you verified it>',
      '',
      `   ${issueReference}`,
      '   EOF',
      '   )"',
      '   ```',
      `   Keep \`${issueReference}\` as the last line of the description.`,
    ];
  }
  return [
    `7. Open a pull request against \`${plan.baseBranch}\` from the strike branch:`,
    '   ```bash',
    `   gh pr create --base ${plan.baseBranch} --head ${plan.branch}${repoFlag} \\`,
    '     --title "<conventional-commit summary of the strike>" \\',
    "     --body-file - <<'EOF'",
    '   <what changed and why, and how you verified it>',
    '',
    `   ${issueReference}`,
    '   EOF',
    '   ```',
    `   Keep \`${issueReference}\` as the last line of the body.`,
  ];
}

function buildStrikePrompt(plan: StrikePlan): string {
  // A closing keyword is deliberate here. Pipeline PRs use a non-closing
  // reference (see buildRichPRBody) because close-out owns closing their
  // issues; a strike has no xBRIEF and never calls `pan done`, so nothing else
  // closes its issue. PR #3972 closed PAN-3963 this way. It is emitted only
  // for a GitHub-tracked issue on the PR's own repo (see closableGithubIssue).
  const issueReference = plan.forge === 'github' && plan.closesGithubIssue !== undefined
    ? `Closes #${plan.closesGithubIssue}`
    : `Issue: ${plan.issueId}`;
  const request = plan.forge === 'gitlab' ? 'merge request' : 'pull request';
  const base = plan.baseBranch;
  return [
    `# Strike: ${plan.issueId}`,
    '',
    'You are a strike agent. Read your role definition (`roles/strike.md`) for the full contract.',
    '',
    '## Your assignment',
    '',
    `- **Issue:** ${plan.issueId}`,
    `- **Workspace:** ${plan.workspace}`,
    `- **Branch:** ${plan.branch} (already checked out)`,
    `- **Base branch:** ${base}`,
    '',
    '## What to do',
    '',
    `1. Read the issue body for ${plan.issueId} (use your tracker tool, e.g. \`gh issue view\`).`,
    '2. Implement the fix in this workspace, scoped to the actual change requested.',
    '3. Commit on the strike branch with a clear message.',
    `4. Sync the latest \`${base}\` into the strike branch:`,
    '   ```bash',
    `   pan sync-main ${plan.issueId}`,
    '   ```',
    '   This is the sanctioned merge-based sync path; do not run raw `git rebase`.',
    `5. Run the full workspace quality gates before opening the ${request}:`,
    '   ```bash',
    '   npm run typecheck && npm run lint && npm test',
    '   ```',
    '6. Push ONLY the strike branch:',
    '   ```bash',
    `   git push origin ${plan.branch}`,
    '   ```',
    ...openRequestLines(plan, issueReference),
    `8. Print the ${request} URL as your final message, then stop. The ${request} is the completion handoff; do not send a Flywheel message.`,
    '',
    `The operator reviews and merges the ${request}. Nothing else lands a strike: no background routine picks up the pushed branch. Do NOT switch to \`${base}\`. Do NOT merge into \`${base}\` or merge the ${request} yourself. Do NOT push \`origin ${base}\`. Do NOT call \`pan done\`. Do NOT call \`pan done <id> --strike\`.`,
    '',
    `If mid-strike you discover the issue is broader than a precision fix, abort, do not push or open a ${request}, and report why so the issue can run through the normal pipeline instead.`,
  ].join('\n');
}

/**
 * Replace a prior strike session so the issue can be struck again.
 *
 * PAN-3150: "a session exists" is NOT "an agent is running". A strike that
 * finished normally leaves its tmux session behind on purpose, so operators can
 * read the transcript — but its last recorded activity is still `active`, so a
 * state-only check reads the corpse as live and refuses to re-dispatch. That
 * closed the loop for the flywheel, which is forbidden `pan kill`: the only verb
 * addressing a `strike-<id>` session was the one that would not reuse it.
 *
 * The harness process tree is the liveness oracle (`isHarnessProcessAlive`
 * walks the pane tree rather than trusting recorded state), but a terminal
 * resolution is stronger evidence that the current strike has finished. Runtime
 * resolution is best-effort, though: an agent that self-aborts at its prompt can
 * leave a stale `working` snapshot when no terminal hook fires. That snapshot is
 * stalled after the shared agent-health threshold, so it must not hold the strike
 * slot forever. Cycling a session is not the one-way door `pan kill` is treated
 * as: the strike worktree, branch, and commits all survive.
 */
async function clearIdlePriorStrike(plan: Pick<StrikePlan, 'sessionName'>, now = Date.now()): Promise<boolean> {
  const hasExistingSession = await Effect.runPromise(sessionExists(plan.sessionName));
  if (!hasExistingSession) return false;

  const runtimeState = await Effect.runPromise(getAgentRuntimeState(plan.sessionName));
  const replaceableStates = new Set(['idle', 'suspended', 'stopped']);
  const terminalResolutions = new Set(['done', 'completed', 'abandoned']);
  const lastActivity = Date.parse(runtimeState?.lastActivity ?? '');
  const isStalled = Number.isFinite(lastActivity) && now - lastActivity >= ACTIVITY_STALLED_MS;
  if (
    runtimeState
    && !replaceableStates.has(runtimeState.state)
    && !terminalResolutions.has(runtimeState.resolution ?? '')
    && !isStalled
  ) {
    // A fresh busy runtime state still needs a live harness process to veto reuse.
    if (await isHarnessProcessAlive(plan.sessionName)) {
      throw new Error(`Agent ${plan.sessionName} already running. Use 'pan tell' to message it.`);
    }
  }

  await Effect.runPromise(stopAgent(plan.sessionName));
  return true;
}

async function runOne(issueId: string, options: StrikeOptions): Promise<void> {
  const spinner = ora(`Striking ${issueId}...`).start();
  try {
    const plan = await resolveStrikePlan(planStrike(issueId));

    if (options.dryRun) {
      spinner.stop();
      console.log(chalk.bold(`\n[dry-run] Would strike ${plan.issueId}`));
      console.log(`  Workspace:  ${plan.workspace}`);
      console.log(`  Branch:     ${plan.branch}`);
      console.log(`  Base:       ${plan.baseBranch} (${plan.forge})`);
      console.log(`  Session:    ${plan.sessionName}`);
      console.log(`  Harness:    ${options.harness ?? 'claude-code'}`);
      console.log(`  Effort:     ${options.effort ?? 'medium'}`);
      if (options.model) console.log(`  Model:      ${options.model}`);
      return;
    }

    spinner.text = `Preparing strike workspace for ${plan.issueId}...`;
    await ensureStrikeWorktree(plan);
    const replacedPriorSession = await clearIdlePriorStrike(plan);

    spinner.text = replacedPriorSession
      ? `Replacing idle prior strike session for ${plan.issueId}...`
      : `Spawning strike agent for ${plan.issueId}...`;
    const prompt = buildStrikePrompt(plan);
    const agent = await spawnAgent({
      issueId: plan.issueId,
      workspace: plan.workspace,
      harness: options.harness,
      model: options.model,
      role: 'strike',
      prompt,
      startedBy: 'operator:cli:pan-strike',
      effort: options.effort,
    });

    spinner.succeed(`Strike agent spawned: ${agent.id}`);
    console.log('');
    console.log(chalk.bold('Strike Details:'));
    console.log(`  Session:    ${chalk.cyan(agent.id)}`);
    console.log(`  Workspace:  ${plan.workspace}`);
    console.log(`  Branch:     ${plan.branch}`);
    console.log(`  Harness:    ${agent.harness ?? 'claude-code'}`);
    console.log(`  Model:      ${agent.model}`);
    console.log('');
    console.log(chalk.dim('Commands:'));
    console.log(`  Attach:   tmux -L overdeck attach -t ${agent.id}`);
    console.log(`  Message:  pan tell ${plan.issueId.toLowerCase()} "your message"`);
    console.log(`  Kill:     pan kill ${plan.issueId.toLowerCase()}`);
  } catch (error: any) {
    spinner.fail(`Strike ${issueId} failed: ${error?.message ?? String(error)}`);
    throw error;
  }
}

/**
 * `pan strike <id> [<id>...]` — spawn one or more strike agents.
 * Each strike skips the normal pipeline and ends with a pull request against
 * main that the operator merges.
 */
export async function strikeCommand(ids: string[], options: StrikeOptions = {}): Promise<void> {
  if (!ids || ids.length === 0) {
    console.error(chalk.red('Issue ID required. Usage: pan strike <id> [<id>...]'));
    return exitCli(1);
  }

  let failures = 0;
  for (const id of ids) {
    try {
      await runOne(id, options);
    } catch {
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(chalk.red(`\n${failures} of ${ids.length} strike(s) failed`));
    return exitCli(1);
  }
}

export const __testInternals = {
  planStrike,
  resolveStrikePlan,
  buildStrikePrompt,
  clearIdlePriorStrike,
  ensureStrikeWorktree,
  registeredWorktreeBranch,
};
