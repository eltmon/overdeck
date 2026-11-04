/**
 * `pan start <id> --remote` and `pan start <id> --machine fly` (PAN-4734 WI-9,
 * FR-1 to FR-3, D-4, D-12).
 *
 * The work agent runs as a conversation on a new Fly machine linked to home,
 * so its transcript is live in the dashboard while it works. Provisioning
 * needs the dashboard's link supervisor, so this CLI never creates a VM: it
 * refuses what the Fly path cannot run (the durable tier, an issue that still
 * has a legacy remote workspace, a feature branch that is not on origin),
 * pushes the branch, and posts `POST /api/remote/work-agents` without a client
 * timeout. The issue is marked in progress after the dashboard answers 201.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import chalk from 'chalk';
import { Effect } from 'effect';
import type { Ora } from 'ora';

import { resolveCliStartedBy } from '../../lib/agents/provenance.js';
import { getDashboardApiUrl, loadConfigSync } from '../../lib/config.js';
import { pushFeatureBranch } from '../../lib/overdeck/feature-branch-push.js';
import { findRemoteWorkspaceMetadata } from '../../lib/remote/workspace-metadata.js';
import { shouldSkipTrackerUpdate } from '../../lib/shadow-mode.js';
import { createShadowState, updateShadowState } from '../../lib/shadow-state.js';
import { getLinearApiKey } from '../../lib/shadow-utils.js';
import { isGitHubIssue, resolveGitHubIssue } from '../../lib/tracker-utils.js';
import { exitCli } from '../exit.js';
import { NEEDS_PAN_UP, NOT_RUNNING } from './machines-call.js';
import { type PostOutcome, postWithoutTimeout } from './machines-fly.js';
import type { IssueOptions } from './start-options.js';

const execFileAsync = promisify(execFile);

/** The work door's 201 body (`StartFlyWorkAgentResult`). */
interface WorkAgentStarted {
  issueId: string;
  agentId: string;
  environmentId: string;
  name: string;
  path: string;
  machine: string;
}

export interface StartRemoteDeps {
  loadConfig: () => { remote?: { resiliency_tier?: 'ephemeral' | 'durable' } };
  findLegacyWorkspace: (issueId: string) => { vmName: string } | null;
  hasLocalWorktree: (workspacePath: string) => boolean;
  pushBranch: (cwd: string, branch: string) => Promise<{ pushed: boolean; reason?: string }>;
  branchOnOrigin: (projectRoot: string, branch: string) => Promise<boolean>;
  dashboardBase: () => string;
  post: (base: string, path: string, body: unknown) => Promise<PostOutcome>;
  markInProgress: (issueId: string, shadow: boolean | undefined) => Promise<void>;
  exit: (code: number) => Promise<never>;
  log: (line: string) => void;
}

async function branchOnOrigin(projectRoot: string, branch: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', '--heads', 'origin', branch], { cwd: projectRoot });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Update Linear issue status to "In Progress" when agent starts
 */
async function updateLinearToInProgress(apiKey: string, issueIdentifier: string): Promise<boolean> {
  try {
    const { LinearClient } = await import('@linear/sdk');
    const client = new LinearClient({ apiKey });

    // Search for the issue by identifier
    const results = await client.searchIssues(issueIdentifier, { first: 1 });
    const issue = results.nodes[0];

    if (!issue) return false;

    // Get the team to find workflow states
    const team = await issue.team;
    if (!team) return false;

    // Find the "In Progress" state
    const states = await team.states();
    const inProgressState = states.nodes.find((s) =>
      s.name === 'In Progress' || s.type === 'started'
    );

    if (!inProgressState) return false;

    // Update the issue state using client.updateIssue
    await client.updateIssue(issue.id, { stateId: inProgressState.id });

    return true;
  } catch {
    // Silently fail - don't block agent spawn for Linear API issues
    return false;
  }
}

/** D-12: the tracker update `pan start --remote` always made, after the agent started. */
async function markInProgress(issueId: string, shadow: boolean | undefined): Promise<void> {
  const skipTrackerUpdate = await shouldSkipTrackerUpdate(issueId, shadow);

  if (skipTrackerUpdate) {
    await createShadowState(issueId, 'open', 'pan start');
    await updateShadowState(issueId, 'in_progress', 'pan start');
    console.log(chalk.cyan(`  👻 Shadow mode: tracking status locally`));
  } else if (isGitHubIssue(issueId)) {
    // GitHub issue — add in-progress label
    const gh = resolveGitHubIssue(issueId);
    if (gh.isGitHub) {
      try {
        const { loadConfigSync: loadYamlConfig } = await import('../../lib/config-yaml.js');
        const yamlConfig = loadYamlConfig();
        const token = yamlConfig.config.trackerKeys?.github || process.env.GITHUB_TOKEN;
        if (token) {
          const { Octokit } = await import('@octokit/rest');
          const octokit = new Octokit({ auth: token });
          await octokit.issues.addLabels({ owner: gh.owner, repo: gh.repo, issue_number: gh.number, labels: ['in-progress'] });
          console.log(chalk.green(`  ✓ Updated ${issueId.toUpperCase()} to In Progress`));
        }
      } catch (err) {
        console.warn(chalk.dim(`  ⚠ Could not update GitHub label: ${(err as Error).message}`));
      }
    }
  } else if (/^[A-Z]+-\d+$/i.test(issueId)) {
    const apiKey = await Effect.runPromise(getLinearApiKey());
    if (apiKey) {
      const updated = await updateLinearToInProgress(apiKey, issueId);
      if (updated) {
        console.log(chalk.green(`  ✓ Updated ${issueId.toUpperCase()} to In Progress`));
      }
    }
  }
}

const defaultDeps: StartRemoteDeps = {
  loadConfig: loadConfigSync,
  findLegacyWorkspace: findRemoteWorkspaceMetadata,
  hasLocalWorktree: (workspacePath) => existsSync(join(workspacePath, '.git')),
  pushBranch: (cwd, branch) => pushFeatureBranch({ cwd, branch }),
  branchOnOrigin,
  dashboardBase: getDashboardApiUrl,
  post: postWithoutTimeout,
  markInProgress,
  exit: exitCli,
  log: (line) => console.log(line),
};

export async function startRemoteWorkAgent(
  issueId: string,
  options: Pick<IssueOptions, 'tier' | 'model' | 'effort' | 'shadow' | 'dryRun'>,
  spinner: Ora,
  input: { projectRoot: string; beforeStart?: () => Promise<void> },
  overrides: Partial<StartRemoteDeps> = {},
): Promise<void> {
  const deps = { ...defaultDeps, ...overrides };
  const issue = issueId.toUpperCase();
  const refuse = (message: string): Promise<never> => {
    spinner.fail(message);
    return deps.exit(1);
  };

  const tier = options.tier ?? deps.loadConfig().remote?.resiliency_tier;
  if (tier === 'durable') {
    return refuse('pan start --remote runs work agents on ephemeral Fly machines; the durable tier is not supported (PAN-4734). Remove --tier durable or set remote.resiliency_tier to ephemeral.');
  }
  const legacy = deps.findLegacyWorkspace(issueId);
  if (legacy) {
    return refuse(`${issue} has a legacy remote workspace (${legacy.vmName}). Destroy it first with pan workspace destroy ${issue}, then run pan start --remote again.`);
  }

  // D-4: the Fly machine checks out the pushed feature branch, so it must be on origin.
  const branch = `feature/${issueId.toLowerCase()}`;
  const workspacePath = join(input.projectRoot, 'workspaces', `feature-${issueId.toLowerCase()}`);
  if (deps.hasLocalWorktree(workspacePath)) {
    spinner.text = `Pushing ${branch}...`;
    const push = await deps.pushBranch(workspacePath, branch);
    if (!push.pushed) {
      return refuse(`Could not push ${branch} before starting the remote work agent: ${push.reason}. Push it with: git -C ${workspacePath} push origin HEAD:refs/heads/${branch}`);
    }
  }
  if (!(await deps.branchOnOrigin(input.projectRoot, branch))) {
    return refuse(`${branch} is not on origin, so the Fly machine cannot check it out. Push it with git push origin HEAD:refs/heads/${branch} from the issue's workspace, then run pan start --remote again.`);
  }

  if (options.dryRun) {
    spinner.info('Dry run mode (remote)');
    deps.log(`Would start the ${issue} work agent as a conversation on a new Fly machine (model: ${options.model || 'default'}).`);
    return;
  }

  await input.beforeStart?.();
  const base = deps.dashboardBase();
  spinner.text = 'Starting a Fly machine and the work agent; this takes 5-15 minutes...';
  const outcome = await deps.post(base, '/api/remote/work-agents', {
    issueId: issue,
    model: options.model || undefined,
    effort: options.effort,
    startedBy: resolveCliStartedBy('operator:cli:pan-start'),
    autoSpawnConsentRequired: process.env['OVERDECK_AUTO_SPAWN_CONSENT_REQUIRED'] === '1',
  });
  if ('unreachable' in outcome) return refuse(NOT_RUNNING);
  if (outcome.status === 401) return refuse(NEEDS_PAN_UP);
  if (outcome.status !== 201) {
    const error = outcome.json as { error?: unknown; message?: unknown } | null;
    const reason = typeof error?.message === 'string' ? error.message : typeof error?.error === 'string' ? error.error : `HTTP ${outcome.status}`;
    return refuse(`Could not start the remote work agent for ${issue}: ${reason}`);
  }

  const started = outcome.json as WorkAgentStarted;
  spinner.succeed(`Work agent for ${issue} runs on ${started.machine}. Open: ${base}${started.path}`);
  await deps.markInProgress(issueId, options.shadow);
  deps.log('');
  deps.log(chalk.dim('Commands:'));
  deps.log(`  Message:  pan tell ${issueId} "your message"`);
  deps.log(`  Kill:     pan kill ${issueId}`);
}
