import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { existsSync, readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline/promises';
import { promisify } from 'util';
import { exec, execFile } from 'child_process';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
import { clearAgentPausedSync, getAgentStateSync, spawnAgent } from '../../lib/agents.js';
import { describeConflictingWorkAgents } from '../../lib/work-agent-conflicts.js';
import { ROLE_EFFORTS, resolveModel as resolveRoleModel, loadConfigSync as loadYamlConfig, type RoleEffort } from '../../lib/config-yaml.js';
import { getModelEffortLevelsSync } from '../../lib/model-capabilities.js';
import { syncMainIntoWorkspace } from '../../lib/cloister/merge-agent.js';
import { resolveProjectFromIssueSync, hasProjectsSync } from '../../lib/projects.js';
import { hasPRDDraft, getPRDDraftPathSync } from '../../lib/prd-draft.js';
import { isGitHubIssueSync, resolveGitHubIssueSync } from '../../lib/tracker-utils.js';
import { Effect } from 'effect';
import { getLinearApiKey } from '../../lib/shadow-utils.js';
import { getReadableWorkspacePanPaths } from '../../lib/pan-dir/index.js';
import type { RuntimeName } from '../../lib/runtimes/types.js';
import { findPlanSync, readWorkspacePlanSync } from '../../lib/vbrief/io.js';
import { findSpecByIssue } from '../../lib/pan-dir/specs.js';
import { writeAutoStartVBrief, type AutoSynthesizeIssueInput } from '../../lib/vbrief/auto-synthesize.js';
import { transitionVBriefOnMain, updatePlanStatus } from '../../lib/vbrief/lifecycle-io.js';
import { resolveIssueWorkModel } from '../../lib/agents/staffing.js';
import {
  buildStartPlanningBody,
  printPlanningConnectionError,
  streamPlanningSession,
} from './planning-stream.js';

/**
 * Check if an issue ID is a Linear issue (has team prefix like MIN-, PAN-, etc.)
 */
function isLinearIssue(issueId: string): boolean {
  return /^[A-Z]+-\d+$/i.test(issueId);
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
  } catch (error) {
    // Silently fail - don't block agent spawn for Linear API issues
    return false;
  }
}

import { shouldSkipTrackerUpdate, getShadowModeStatus } from '../../lib/shadow-mode.js';
import { createShadowState, updateShadowState } from '../../lib/shadow-state.js';
import { getDashboardApiUrlSync, loadConfigSync } from '../../lib/config.js';
import {
  loadWorkspaceMetadataSync,
  findRemoteWorkspaceMetadataSync,
} from '../../lib/remote/workspace-metadata.js';
import { spawnRemoteAgent, isRemoteAgentRunning, createFlyProviderFromConfig, checkRemoteSpendCap, isRemoteAvailable } from '../../lib/remote/index.js';
import type { RemoteWorkspaceMetadata } from '../../lib/remote/interface.js';
import type { SpawnRemoteAgentOptions } from '../../lib/remote/remote-agents.js';
import { assertCanStartFreshSync, getWorkAgentLifecycleStateSync } from '../../lib/work-agent-lifecycle.js';
import { normalizeModelOverrideSync } from '../../lib/model-validation.js';
import { resolvePlanningMode, type PlanningMode } from './planning-mode.js';
import { requireAutomaticStateMigration } from '../../lib/state-auto-migrate.js';

interface IssueOptions {
  model: string;
  /** PAN-636 — explicit coding-agent harness override. Omit to use resolver defaults. */
  harness?: RuntimeName;
  /** Claude Code `--effort` level. Overrides roles.work.effort for this spawn. */
  effort?: RoleEffort;
  dryRun?: boolean;
  shadow?: boolean;
  remote?: boolean;
  local?: boolean;
  /** Remote workspace resiliency tier override: ephemeral | durable. */
  tier?: string;
  /** Explicit planning-depth flag: interactive | auto | skip. */
  plan?: string;
  /** Legacy auto-skip-planning flag; deprecated — use --plan skip instead. */
  auto?: boolean;
  host?: boolean;
  yes?: boolean;
  force?: boolean;
  /** Drop the saved Claude session pointer (non-destructive) and start a brand-new
   *  session — the one-step "restart fresh" path, e.g. to switch a stopped agent's model. */
  fresh?: boolean;
  /** Resolved planning mode for this start invocation. Set by issueCommand. */
  planningMode?: PlanningMode;
}

/**
 * Determine workspace location based on flags and config
 * Returns: 'local' | 'remote' | null (null means check both)
 */
function determineWorkspaceLocation(options: IssueOptions): 'local' | 'remote' | null {
  // Explicit flags take precedence
  if (options.remote && options.local) {
    throw new Error('Cannot specify both --remote and --local');
  }

  if (options.remote) {
    return 'remote';
  }

  if (options.local) {
    return 'local';
  }

  // Check config for default location
  const config = loadConfigSync();
  if (config.remote?.enabled && config.remote.default_location) {
    return config.remote.default_location;
  }

  // Default: check both (local takes precedence if both exist)
  return null;
}

async function confirmHostOverride(options: IssueOptions): Promise<boolean> {
  if (!options.host) return true;

  if (!process.stdin.isTTY) {
    if (options.yes) {
      console.warn(chalk.yellow('--host --yes given in a non-interactive context; bypassing workspace isolation.'));
      return true;
    }
    console.error(chalk.red('Error: --host requires an interactive confirmation, or pass --yes for non-interactive use.'));
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(chalk.bold('Are you sure? This bypasses workspace isolation. (y/N) '))).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function resolveExplicitHarnessFlag(
  harness: string | undefined,
  model: string | undefined,
): Promise<RuntimeName | undefined> {
  if (harness === undefined) {
    return undefined;
  }

  if (harness !== 'claude-code' && harness !== 'ohmypi' && harness !== 'codex') {
    process.stderr.write(`Invalid --harness value: ${harness}. Expected 'claude-code', 'ohmypi', or 'codex'.\n`);
    process.exit(1);
  }

  if (model) {
    const { canUseHarnessSync } = await import('../../lib/harness-policy.js');
    const { getProviderAuthMode } = await import('../../lib/agents.js');
    const decision = canUseHarnessSync(harness, model, await getProviderAuthMode(model));
    if (!decision.allowed) {
      process.stderr.write(`${decision.reason}\n`);
      process.exit(1);
    }
  }

  return harness;
}

/**
 * Find workspace directory - checks local first, then remote metadata
 */
function findWorkspaceWithLocation(
  issueId: string,
  location: 'local' | 'remote' | null,
  labels: string[] = []
): { workspacePath: string | null; isRemote: boolean } {
  const normalizedId = issueId.toLowerCase();

  // If explicitly remote, only check remote
  if (location === 'remote') {
    const remoteMetadata = findRemoteWorkspaceMetadataSync(issueId);
    if (remoteMetadata) {
      return { workspacePath: remoteMetadata.id, isRemote: true };
    }
    return { workspacePath: null, isRemote: true };
  }

  // If explicitly local or no preference, check local first
  if (location === 'local' || location === null) {
    const localWorkspace = findLocalWorkspace(issueId, labels);
    if (localWorkspace) {
      return { workspacePath: localWorkspace, isRemote: false };
    }
  }

  // If no local workspace found and no explicit local preference, check remote
  if (location === null) {
    const remoteMetadata = findRemoteWorkspaceMetadataSync(issueId);
    if (remoteMetadata) {
      return { workspacePath: remoteMetadata.id, isRemote: true };
    }
  }

  return { workspacePath: null, isRemote: false };
}

/**
 * Find the local workspace directory for an issue.
 */
function findLocalWorkspace(issueId: string, labels: string[] = []): string | null {
  const normalizedId = issueId.toLowerCase();

  // First, try to resolve from project registry
  const resolved = resolveProjectFromIssueSync(issueId, labels);
  if (resolved) {
    const workspaceName = `feature-${normalizedId}`;
    const workspacePath = join(resolved.projectPath, 'workspaces', workspaceName);
    if (existsSync(workspacePath)) {
      return workspacePath;
    }
    // Also try without "feature-" prefix
    const altPath = join(resolved.projectPath, 'workspaces', normalizedId);
    if (existsSync(altPath)) {
      return altPath;
    }
  }

  // Fall back to searching upward from cwd (backward compatible)
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const workspacesDir = join(dir, 'workspaces');
    if (existsSync(workspacesDir)) {
      // Look for feature-{issue-id} workspace
      const workspaceName = `feature-${normalizedId}`;
      const workspacePath = join(workspacesDir, workspaceName);
      if (existsSync(workspacePath)) {
        return workspacePath;
      }

      // Also try without "feature-" prefix
      const altPath = join(workspacesDir, normalizedId);
      if (existsSync(altPath)) {
        return altPath;
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * Find the workspace directory for an issue (local only - backward compatible).
 * @deprecated Use findLocalWorkspace or findWorkspaceWithLocation instead
 */
function findWorkspace(issueId: string, labels: string[] = []): string | null {
  return findLocalWorkspace(issueId, labels);
}

async function fetchIssueForAutoStart(issueId: string): Promise<AutoSynthesizeIssueInput> {
  const github = resolveGitHubIssueSync(issueId);
  if (github.isGitHub) {
    try {
      const { stdout } = await execFileAsync('gh', ['issue', 'view', String(github.number), '--repo', `${github.owner}/${github.repo}`, '--json', 'title,body,url'], {
        encoding: 'utf-8',
        timeout: 15000,
      });
      const parsed = JSON.parse(stdout) as { title?: string; body?: string; url?: string };
      return { issueId, title: parsed.title || issueId, body: parsed.body || '', url: parsed.url };
    } catch {
      return { issueId, title: issueId, body: '' };
    }
  }

  if (isLinearIssue(issueId)) {
    const apiKey = await Effect.runPromise(getLinearApiKey());
    if (apiKey) {
      try {
        const { LinearClient } = await import('@linear/sdk');
        const client = new LinearClient({ apiKey });
        const results = await client.searchIssues(issueId, { first: 1 });
        const issue = results.nodes[0];
        if (issue) {
          return { issueId, title: issue.title, body: issue.description ?? '', url: issue.url };
        }
      } catch { /* fall through */ }
    }
  }

  return { issueId, title: issueId, body: '' };
}

/**
 * Handle remote workspace agent spawning
 */
async function handleRemoteWorkspace(
  issueId: string,
  options: IssueOptions,
  spinner: Ora,
  clearPauseBeforeSpawn: boolean
): Promise<void> {
  const config = loadConfigSync();

  // Verify remote is enabled
  if (!config.remote?.enabled) {
    spinner.fail('Remote workspaces not enabled');
    console.log('');
    console.log(chalk.dim('Run: pan admin remote setup'));
    console.log(chalk.dim('This writes the required remote settings to ~/.overdeck/config.toml'));
    process.exit(1);
  }

  // Check remote availability
  spinner.text = 'Checking remote availability...';
  const availability = await isRemoteAvailable();
  if (!availability.available) {
    spinner.fail('Remote not available');
    console.log('');
    console.log(chalk.yellow(availability.reason || 'Unknown error'));

    // If user explicitly requested remote, fail
    if (options.remote) {
      process.exit(1);
    }

    // Otherwise, suggest creating local workspace
    console.log('');
    console.log(chalk.bold('To create a local workspace instead:'));
    console.log(`  ${chalk.cyan(`pan workspace ${issueId} --local`)}`);
    console.log(`  ${chalk.cyan(`pan start ${issueId} --local`)}`);
    process.exit(1);
  }

  // Check for existing remote workspace
  let remoteMetadata = findRemoteWorkspaceMetadataSync(issueId);

  // Auto-create if not found
  if (!remoteMetadata) {
    spinner.text = 'Remote workspace not found, creating...';
    try {
      const { createRemoteWorkspace } = await import('../../lib/remote-workspace.js');
      remoteMetadata = await Effect.runPromise(createRemoteWorkspace(issueId, { spinner, tier: options.tier as 'ephemeral' | 'durable' | undefined }));
    } catch (error: any) {
      spinner.fail(`Failed to create remote workspace: ${error.message}`);
      process.exit(1);
    }
  }

  // Check if remote agent already running
  spinner.text = 'Checking for existing agent...';
  const agentId = `agent-${issueId.toLowerCase()}`;
  const isRunning = await isRemoteAgentRunning(agentId, remoteMetadata.vmName);

  if (isRunning) {
    spinner.fail(`Agent ${agentId} already running on remote VM`);
    console.log('');
    console.log(chalk.dim(`Use 'pan tell ${issueId} "message"' to send commands`));
    process.exit(1);
  }

  // Resolve the effective tier up front so dry-run output and the provider
  // both see the same value (CLI flag wins over config default).
  const tier = (options.tier as 'ephemeral' | 'durable' | undefined) ?? config.remote?.resiliency_tier;

  if (options.dryRun) {
    spinner.info('Dry run mode (remote)');
    console.log('');
    console.log(chalk.bold('Would create:'));
    console.log(`  Agent ID:   ${agentId}`);
    console.log(`  VM:         ${chalk.cyan(remoteMetadata.vmName)}`);
    console.log(`  Provider:   ${remoteMetadata.provider}`);
    console.log(`  Tier:       ${tier ?? 'ephemeral'}`);
    console.log(`  Model:      ${options.model || 'default'}`);
    return;
  }

  // Build prompt for remote agent
  spinner.text = 'Building agent prompt...';
  const projectRoot = findProjectRoot(issueId);
  const prompt = await buildWorkAgentPrompt({ issueId, env: 'REMOTE', workspacePath: '/workspace', skipDynamicContext: true });

  // Sync all credentials before spawning (tokens may have expired)
  spinner.text = 'Syncing credentials (Claude, GitHub)...';
  const fly = createFlyProviderFromConfig(config.remote, tier);
  const credsSynced = await fly.syncAllCredentials(remoteMetadata.vmName);
  if (!credsSynced.claude) {
    spinner.warn('Could not sync Claude credentials - agent may need to re-authenticate');
  }
  if (!credsSynced.github) {
    spinner.warn('Could not sync GitHub CLI auth - gh commands may fail');
  }

  // Re-apply Claude Code config (onboarding marker, /workspace trust,
  // settings.json permission mode) — idempotent, heals VMs created before
  // a config change.
  await fly.configureClaudeCode(remoteMetadata.vmName);

  // Enforce remote.max_concurrent_agents spend guardrail before provisioning
  // more Fly resources. A cap of zero or unset is unlimited.
  const spendCap = checkRemoteSpendCap(config);
  if (!spendCap.allowed) {
    spinner.fail(spendCap.message!);
    process.exit(1);
  }

  // Spawn remote agent
  spinner.text = 'Spawning remote agent...';

  try {
    if (clearPauseBeforeSpawn) {
      clearAgentPausedSync(agentId);
    }

    const remoteAgent = await spawnRemoteAgent({
      issueId,
      workspace: remoteMetadata,
      // harness flows in once the remote-spawn path supports it; the front-end
      // gate still rejects invalid combos before we reach this call so the
      // remote agent will see harness=claude-code today (Pi is local-only
      // until the Fly worker image bundles the pi binary — tracked separately).
      model: options.model,
      prompt,
      tier: fly.getResiliencyTier(),
    });

    spinner.succeed(`Remote agent spawned: ${remoteAgent.id}`);

    // Handle shadow mode
    const skipTrackerUpdate = await Effect.runPromise(shouldSkipTrackerUpdate(issueId, options.shadow));

    if (skipTrackerUpdate) {
      await Effect.runPromise(createShadowState(issueId, 'open', 'pan start'));
      await Effect.runPromise(updateShadowState(issueId, 'in_progress', 'pan start'));
      console.log(chalk.cyan(`  👻 Shadow mode: tracking status locally`));
    } else if (isGitHubIssueSync(issueId)) {
      // GitHub issue — add in-progress label
      const gh = resolveGitHubIssueSync(issueId);
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
        } catch (err: any) {
          console.warn(chalk.dim(`  ⚠ Could not update GitHub label: ${err.message}`));
        }
      }
    } else if (isLinearIssue(issueId)) {
      const apiKey = await Effect.runPromise(getLinearApiKey());
      if (apiKey) {
        const updated = await updateLinearToInProgress(apiKey, issueId);
        if (updated) {
          console.log(chalk.green(`  ✓ Updated ${issueId.toUpperCase()} to In Progress`));
        }
      }
    }

    console.log('');
    console.log(chalk.bold('Agent Details:'));
    console.log(`  Session:    ${chalk.cyan(remoteAgent.id)}`);
    console.log(`  VM:         ${chalk.cyan(remoteMetadata.vmName)}`);
    console.log(`  Location:   ${chalk.yellow('Remote (Fly.io)')}`);
    console.log(`  Model:      ${remoteAgent.model}`);

    if (remoteMetadata.urls.frontend || remoteMetadata.urls.api) {
      console.log('');
      console.log(chalk.bold('URLs:'));
      if (remoteMetadata.urls.frontend) {
        console.log(`  Frontend: ${chalk.cyan(remoteMetadata.urls.frontend)}`);
      }
      if (remoteMetadata.urls.api) {
        console.log(`  API:      ${chalk.cyan(remoteMetadata.urls.api)}`);
      }
    }

    console.log('');
    console.log(chalk.dim('Commands:'));
    console.log(`  SSH:      pan workspace ssh ${issueId}`);
    console.log(`  Message:  pan tell ${issueId} "your message"`);
    console.log(`  Kill:     pan kill ${issueId}`);

  } catch (error: any) {
    spinner.fail(`Failed to spawn remote agent: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Ensure remote workspace exists, auto-create if needed
 */
async function ensureRemoteWorkspace(
  issueId: string,
  spinner: Ora
): Promise<RemoteWorkspaceMetadata | null> {
  // Check if remote workspace already exists
  const existing = findRemoteWorkspaceMetadataSync(issueId);
  if (existing) {
    return existing;
  }

  // Auto-create remote workspace
  spinner.text = 'Creating remote workspace...';

  const config = loadConfigSync();
  if (!config.remote?.enabled) {
    throw new Error('Remote workspaces not enabled. Run `pan remote setup`');
  }

  // Check remote availability
  const availability = await isRemoteAvailable();
  if (!availability.available) {
    throw new Error(`Remote not available: ${availability.reason}`);
  }

  // Import workspace creation logic
  const { createRemoteWorkspace } = await import('../../lib/remote-workspace.js');

  try {
    const metadata = await Effect.runPromise(createRemoteWorkspace(issueId));
    return metadata;
  } catch (error: any) {
    throw new Error(`Failed to create remote workspace: ${error.message}`);
  }
}

/**
 * Find the project root (contains workspaces/, .git, or CLAUDE.md)
 * First checks project registry, then falls back to searching upward.
 */
function findProjectRoot(issueId?: string, labels: string[] = []): string {
  // If we have an issue ID, try to resolve from registry first
  if (issueId) {
    const resolved = resolveProjectFromIssueSync(issueId, labels);
    if (resolved) {
      return resolved.projectPath;
    }
  }

  // Fall back to searching upward from cwd
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'workspaces')) ||
        existsSync(join(dir, '.git')) ||
        existsSync(join(dir, 'CLAUDE.md'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

import {
  buildWorkAgentPrompt,
  getTrackerContext,
  readPlanningContext,
} from '../../lib/cloister/work-agent-prompt.js';

/**
 * Validate that the resolved vBRIEF belongs to the current issue.
 * Uses findPlan (resolves main-side spec first, then workspace fallback).
 */
function validatePlanMatchesIssue(workspacePath: string, issueId: string): { valid: boolean; wrongIssue?: string } {
  const planPath = findPlanSync(workspacePath);

  if (!planPath) {
    return { valid: true };
  }

  try {
    const raw = readFileSync(planPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const planIssueId = parsed?.plan?.id;

    if (planIssueId && planIssueId.toLowerCase() !== issueId.toLowerCase()) {
      return { valid: false, wrongIssue: planIssueId.toUpperCase() };
    }
  } catch {
    // If we can't read/parse the file, let other validations handle it
  }

  return { valid: true };
}


/**
 * Validate that the continue file belongs to the current issue.
 * If the continue file is for a different issue (cross-contamination from git merge),
 * remove it to prevent the agent from working on the wrong issue.
 *
 * Returns valid:true if the continue file matches the current issue or doesn't exist.
 */
function validateAndCleanStateFile(workspacePath: string, issueId: string): { valid: boolean; removed: boolean; wrongIssue?: string } {
  const upperId = issueId.toUpperCase();
  const { continuePath } = getReadableWorkspacePanPaths(workspacePath);

  if (!existsSync(continuePath)) {
    return { valid: true, removed: false };
  }

  try {
    const { unlinkSync } = require('fs');
    const raw = readFileSync(continuePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.issueId && typeof parsed.issueId === 'string') {
      const recordedId = parsed.issueId.toUpperCase();
      if (recordedId !== upperId) {
        try { unlinkSync(continuePath); } catch { /* ignore */ }
        console.warn(chalk.yellow(`⚠️  Removed stale continue file (was for ${recordedId}, not ${upperId})`));
        console.warn(chalk.dim('   This can happen when branches are merged. The agent will start fresh.'));
        return { valid: false, removed: true, wrongIssue: recordedId };
      }
    }
    return { valid: true, removed: false };
  } catch {
    return { valid: true, removed: false };
  }
}

interface PostCreateValidationFailureOptions {
  spinner: Ora;
  issueId: string;
  projectRoot: string;
  workspaceCreatedThisRun: boolean;
  message: string;
  printDetails: () => void;
}

async function failPostCreateValidation(options: PostCreateValidationFailureOptions): Promise<never> {
  options.spinner.fail(options.message);
  options.printDetails();

  if (options.workspaceCreatedThisRun) {
    const nodeDir = dirname(process.execPath);
    try {
      await execFileAsync('pan', ['workspace', 'destroy', options.issueId, '--force', '--project', options.projectRoot], {
        cwd: options.projectRoot,
        encoding: 'utf-8',
        timeout: 120000,
        env: { ...process.env, PATH: `${nodeDir}:${process.env.PATH}` },
      });
      console.log(chalk.dim(`Rolled back workspace created for ${options.issueId}.`));
    } catch (rollbackErr: any) {
      console.warn(chalk.yellow(`Warning: failed to roll back workspace for ${options.issueId}: ${rollbackErr.message}`));
    }
  }

  process.exit(1);
}

async function repairMainBranchWorkspace(workspace: string, normalizedId: string): Promise<string | null> {
  const featureBranch = `feature/${normalizedId}`;

  try {
    const [{ stdout: topLevel }, { stdout: status }] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: workspace, encoding: 'utf-8' }),
      execFileAsync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf-8' }),
    ]);

    if (resolve(topLevel.trim()) !== resolve(workspace)) return null;
    if (status.trim().length > 0) return null;

    const { stdout: matchingBranches } = await execFileAsync('git', ['branch', '--list', featureBranch], {
      cwd: workspace,
      encoding: 'utf-8',
    });
    const branchExists = matchingBranches
      .split('\n')
      .map((line) => line.replace(/^[*+\s]+/, '').trim())
      .includes(featureBranch);

    await execFileAsync('git', branchExists ? ['switch', featureBranch] : ['switch', '-c', featureBranch], {
      cwd: workspace,
      encoding: 'utf-8',
    });
    return featureBranch;
  } catch {
    return null;
  }
}

/** PAN-2410: --fresh means fresh STAFFING, not just a fresh session. Never
 * inherit the dead agent's recorded model — with no explicit --model the
 * tier/role resolvers run against current config. A plain restart (no
 * --fresh) keeps the recorded staffing, by design. */
export function resolveSpawnModel(
  explicitModel: string | undefined,
  fresh: boolean | undefined,
  recordedModel: string | undefined,
): string | undefined {
  return explicitModel || (fresh ? undefined : recordedModel);
}

export async function issueCommand(id: string, options: IssueOptions): Promise<void> {
  try {
    const model = normalizeModelOverrideSync(options.model);
    if (model) options.model = model;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  if (!(await confirmHostOverride(options))) {
    process.exit(1);
  }

  // Normalize issue ID (MIN-648 -> min-648 for tmux session name)
  const normalizedId = id.toLowerCase();
  const agentId = `agent-${normalizedId}`;
  const existingAgentState = getAgentStateSync(agentId);
  const spawnModel = resolveSpawnModel(options.model ?? resolveIssueWorkModel(id.toUpperCase()), options.fresh, existingAgentState?.model);
  // PAN-636 — validate only an explicit --harness flag up front. Flagless
  // spawns intentionally forward undefined so spawnAgent's resolveHarness()
  // applies role/provider defaults after model resolution.
  const requestedHarness = await resolveExplicitHarnessFlag(options.harness, spawnModel);

  // PAN-1845: validate --tier early so an invalid tier fails before any
  // workspace setup. The CLI flag overrides config.remote.resiliency_tier for
  // this spawn only.
  const VALID_TIERS = ['ephemeral', 'durable'] as const;
  if (options.tier && !VALID_TIERS.includes(options.tier as (typeof VALID_TIERS)[number])) {
    process.stderr.write(`Invalid --tier value: ${options.tier}. Expected 'ephemeral' or 'durable'.\n`);
    process.exit(1);
  }

  // Resolve the Claude Code --effort level for this spawn: explicit --effort
  // wins, otherwise fall back to roles.work.effort from config. The flag
  // bypasses config-load validation, so validate it here (base enum + the
  // resolved model's supported levels) before any workspace setup.
  const yamlConfig = loadYamlConfig().config;
  const resolvedEffort: RoleEffort | undefined = options.effort ?? yamlConfig.roles?.work?.effort;
  if (resolvedEffort !== undefined) {
    if (!ROLE_EFFORTS.includes(resolvedEffort)) {
      process.stderr.write(`Invalid --effort value: ${resolvedEffort}. Expected one of ${ROLE_EFFORTS.join(', ')}.\n`);
      process.exit(1);
    }
    const workModel = resolveRoleModel('work', spawnModel || undefined, yamlConfig);
    const supportedEfforts = getModelEffortLevelsSync(workModel);
    if (supportedEfforts !== undefined && !supportedEfforts.includes(resolvedEffort)) {
      process.stderr.write(`Effort '${resolvedEffort}' is not supported by ${workModel} (supported: ${supportedEfforts.join(', ')}).\n`);
      process.exit(1);
    }
  }

  // Resolve planning mode for pan start (PAN-2407): explicit --plan wins over
  // legacy --auto, then config.planning.default_mode, then shipped default 'auto'.
  let resolvedPlanningMode: PlanningMode;
  try {
    const planningResolution = resolvePlanningMode({
      planFlag: options.plan,
      legacyAuto: options.auto,
      configDefault: yamlConfig.planning?.defaultMode,
    });
    resolvedPlanningMode = planningResolution.mode;
    for (const warning of planningResolution.warnings) {
      console.warn(warning);
    }
  } catch (error) {
    process.stderr.write(chalk.red(`${error instanceof Error ? error.message : String(error)}\n`));
    process.exit(1);
  }
  options.planningMode = resolvedPlanningMode;
  // Preserve legacy behavior until route-unplanned-to-planning bead fully wires
  // resolved mode into the spawn path.
  options.auto = resolvedPlanningMode === 'skip';

  const shouldClearPauseBeforeSpawn = existingAgentState?.paused === true && options.force === true;
  if (existingAgentState?.paused === true && !options.force) {
    process.stderr.write(chalk.red(`Agent ${agentId} is paused and will not be started.\n`));
    if (existingAgentState.pausedReason) {
      process.stderr.write(chalk.red(`Pause reason: ${existingAgentState.pausedReason}\n`));
    }
    process.stderr.write(chalk.red(`Run pan unpause ${id} to clear the pause, or pan start ${id} --force to override.\n`));
    process.exit(1);
  }
  if (existingAgentState?.troubled === true) {
    const failures = existingAgentState.consecutiveFailures ?? 0;
    process.stderr.write(chalk.red(`Agent ${agentId} is troubled (${failures} failure${failures === 1 ? '' : 's'}) and will not be started.\n`));
    if (existingAgentState.lastFailureReason) {
      process.stderr.write(chalk.red(`Last failure: ${existingAgentState.lastFailureReason}\n`));
    }
    process.stderr.write(chalk.red(`Investigate the crash cause, then run pan untroubled ${id} before starting.\n`));
    process.exit(1);
  }

  // No-op with exit 0 when the work agent is already live and running.
  // Paused/troubled cases are handled above; stopped-but-resumable cases are
  // left for assertCanStartFreshSync below so the user sees the resume/fresh
  // guidance unchanged (hazard H2).
  const lifecycleState = getWorkAgentLifecycleStateSync(agentId);
  if (lifecycleState.isRunning && !lifecycleState.isRunningButStuck) {
    console.log(chalk.green(`Work agent for ${id} is already running.`));
    console.log('');
    console.log(chalk.dim('Message it:'), chalk.cyan(`pan tell ${id} "..."`));
    console.log(chalk.dim('Attach:  '), chalk.cyan(`tmux -L overdeck attach -t ${agentId}`));
    process.exitCode = 0;
    return;
  }
  const conflict = describeConflictingWorkAgents(id, agentId);
  if (conflict) {
    process.stderr.write(chalk.red(conflict));
    process.exit(1);
  }
  const spinner = ora(`Preparing workspace for ${id}...`).start();
  try {
    const locationPreference = determineWorkspaceLocation(options);
    // Log project resolution info
    const resolved = resolveProjectFromIssueSync(id);
    if (resolved) {
      spinner.text = `Resolved project: ${resolved.projectName} (${resolved.projectPath})`;
      spinner.text = `Reconciling permanent state for ${resolved.projectName}...`;
      await requireAutomaticStateMigration(resolved);
    }
    // Find workspace (local or remote based on preference)
    const { workspacePath, isRemote } = findWorkspaceWithLocation(id, locationPreference);

    // Overflow scale-out (PAN-1676): a FRESH issue (no workspace anywhere, no
    // explicit --local) routes to a fly.io machine when the local work pool is
    // already at max_work_agents and remote.overflow_to_remote is enabled.
    // Compute this before the PAN-2407 planning route so the start-planning
    // request reports the resolved workspace location (local vs remote).
    let overflowToRemote = false;
    if (!isRemote && !workspacePath && !options.local && locationPreference !== 'local') {
      const overflowConfig = loadConfigSync().remote;
      if (overflowConfig?.enabled && overflowConfig.overflow_to_remote) {
        const { getConcurrencyLimits, countRunningAgents } = await import('../../lib/cloister/concurrency.js');
        const limits = getConcurrencyLimits();
        const counts = countRunningAgents();
        if (counts.work >= limits.maxWorkAgents) {
          overflowToRemote = true;
          console.log(chalk.cyan(
            `Local work pool full (${counts.work}/${limits.maxWorkAgents}) — overflowing ${id} to a remote fly.io machine.`
          ));
        }
      }
    }
    const effectiveRemote = isRemote || overflowToRemote || (locationPreference === 'remote' && !workspacePath);

    // PAN-2407: route unplanned issues to the start-planning endpoint before
    // any workspace creation or remote provisioning.
    const projectRoot = findProjectRoot(id);
    const existingPlan = workspacePath && !isRemote
      ? findPlanSync(workspacePath)
      : await Effect.runPromise(findSpecByIssue(projectRoot, id));

    if (!existingPlan) {
      if (resolvedPlanningMode === 'auto' || resolvedPlanningMode === 'interactive') {
        if (options.dryRun) {
          spinner.info(`Would start ${resolvedPlanningMode} planning session for ${id} (work agent auto-starts on finalize)`);
          return;
        }

        spinner.text = `Starting ${resolvedPlanningMode} planning session for ${id}...`;
        let sessionName = '';
        try {
          const response = await fetch(
            `${getDashboardApiUrlSync()}/api/issues/${encodeURIComponent(id)}/start-planning`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: buildStartPlanningBody({
                auto: resolvedPlanningMode === 'auto',
                autoStart: true,
                probe: false,
                model: options.model,
                harness: options.harness,
                effort: options.effort,
                workspaceLocation: effectiveRemote ? 'remote' : 'local',
              }),
            },
          );

          if (!response.ok) {
            let message = `Planning failed (${response.status})`;
            try {
              const data = (await response.json()) as { error?: string; hint?: string };
              message = data.error || data.hint || message;
            } catch {
              const text = await response.text().catch(() => '');
              if (text) message = text;
            }
            throw new Error(message);
          }

          await streamPlanningSession(response, {
            issueId: id,
            setSpinnerText: (text) => { spinner.text = text; },
            onComplete: (name) => { sessionName = name; },
          });

          spinner.succeed(
            `${resolvedPlanningMode === 'auto' ? 'Auto-planning' : 'Planning'} session started for ${id}${sessionName ? ` (${sessionName})` : ''}. The work agent will start automatically after planning finalizes.`,
          );
          return;
        } catch (error) {
          spinner.fail(error instanceof Error ? error.message : String(error));
          printPlanningConnectionError(id);
          process.exit(1);
        }
      }
      // mode === 'skip': fall through to the existing auto-synthesize path.
    }

    // --fresh: wipe the work agent's state directory under
    // ~/.overdeck/agents/agent-<id>/ (PAN-1985) so the start below opens a
    // brand-new session against a clean dir. The new agent reads
    // .pan/continue.json, the vBRIEF, the beads, and the branch state to
    // pick up where the prior run left off.
    //
    // Operator note: --fresh is the deliberate override for harness/model
    // switches (where the saved Claude session cannot be resumed under a
    // different harness) and for "I want a clean work run" recovery. The
    // NORMAL review flow continues the same session across re-dispatches
    // (PAN-1862); --fresh is the escape hatch that pays the re-research
    // cost. Workspace, vBRIEF, beads, .pan/continue.json, .pan/feedback/,
    // branch, and commit history are all left untouched.
    //
    // Refuses if a live tmux session is alive (the wipe would race with it).
    // For the narrow "just clear the four session tracking files" reset, use
    // `pan reset-session <id>` directly — it's intentionally non-destructive
    // and is used by the harness-policy subsystem as a building block.
    if (options.fresh) {
      const agentIdForFresh = `agent-${id.toLowerCase()}`;
      const priorState = getAgentStateSync(agentIdForFresh);
      if (priorState) {
        const { sessionExistsSync } = await import('../../lib/tmux.js');
        if (sessionExistsSync(agentIdForFresh)) {
          console.error(chalk.red(`Agent ${agentIdForFresh} has a live tmux session. Run 'pan kill ${id}' first, then retry --fresh.`));
          process.exit(1);
        }
        const { wipeAgentStateDirs } = await import('../../lib/agents.js');
        const wipeResult = await wipeAgentStateDirs(id);
        console.log(chalk.dim(`  --fresh: wiped ${wipeResult.removed.length} agent state director${wipeResult.removed.length === 1 ? 'y' : 'ies'} for ${id} (path: ${wipeResult.path})`));
      }
      // No prior state → nothing to wipe; fall through to the normal start
      // path (which will create the agent dir fresh).
    }

    // Refuse fresh start when a resumable session still exists after the
    // --fresh wipe. (The wipe above should have cleared it, but guard
    // belt-and-suspenders.) Users must choose resume, `pan start --fresh`,
    // or reset-session explicitly.
    // Users must choose resume, `pan start --fresh`, or reset-session explicitly.
    try {
      assertCanStartFreshSync(id, { allowPausedForce: shouldClearPauseBeforeSpawn });
    } catch (error) {
      if (workspacePath || isRemote) {
        throw error;
      }
    }

    // Handle remote workspace
    if (effectiveRemote) {
      await handleRemoteWorkspace(id, options, spinner, shouldClearPauseBeforeSpawn);
      return;
    }

    // Handle local workspace
    let workspace = workspacePath;
    const workspaceExisted = !!workspace;
    let workspaceCreatedThisRun = false;
    let skipSyncMainForUnsafeWorkspace = false;

    if (!workspace) {
      spinner.text = `Creating workspace for ${id}...`;
      const expectedWorkspacePath = join(projectRoot, 'workspaces', `feature-${normalizedId}`);
      try {
        const nodeDir = dirname(process.execPath);
        await execAsync(
          `pan workspace create ${id} --local`,
          { cwd: projectRoot, encoding: 'utf-8', timeout: 60000, env: { ...process.env, PATH: `${nodeDir}:${process.env.PATH}` } }
        );
        workspace = expectedWorkspacePath;
        workspaceCreatedThisRun = true;
      } catch (wsErr) {
        spinner.fail(`Failed to create workspace for ${id}: ${(wsErr as Error).message}`);
        process.exit(1);
      }
    }

    if (workspaceExisted) {
      try {
        const { execSync } = await import('child_process');
        const branch = execSync('git branch --show-current', {
          cwd: workspace,
          encoding: 'utf8'
        }).trim();
        if (branch === 'main' || branch === 'master') {
          const repairedBranch = await repairMainBranchWorkspace(workspace, normalizedId);
          if (repairedBranch) {
            spinner.text = `Moved clean workspace to branch: ${repairedBranch}`;
          } else {
            skipSyncMainForUnsafeWorkspace = true;
            spinner.text = `Workspace is on ${branch} branch; skipping sync-main until validation runs`;
          }
        }
      } catch {
        // Let the post-sync verification below surface the canonical warning.
      }
    }

    // If workspace was created during planning, main may have moved forward.
    // Fetch and merge latest main before the agent starts working.
    if (workspaceExisted && !skipSyncMainForUnsafeWorkspace) {
      spinner.text = 'Syncing latest main into workspace...';
      let syncConflictFiles: string[] | undefined;
      try {
        const syncResult = await syncMainIntoWorkspace(workspace, id);
        if (syncResult.success) {
          if (syncResult.alreadyUpToDate) {
            spinner.text = 'Workspace already up to date with main';
          } else {
            spinner.text = `Synced main into workspace (${syncResult.commitCount ?? 0} commit(s))`;
          }
        } else {
          syncConflictFiles = syncResult.conflictFiles;
          const conflictHint = syncConflictFiles?.length
            ? ` Conflicts: ${syncConflictFiles.join(', ')}.`
            : '';
          spinner.warn(`Could not sync main: ${syncResult.reason || 'unknown reason'}${conflictHint}`);
        }
      } catch (syncErr: any) {
        spinner.warn(`Sync main failed: ${syncErr.message}`);
      }

      // PAN-1872: a sync-main conflict must not strand the issue. Continue
      // spawning the work agent so it can resolve the conflicts and re-submit.
      if (syncConflictFiles && syncConflictFiles.length > 0) {
        spinner.text = `Preparing agent to resolve ${syncConflictFiles.length} sync-main conflict(s)...`;
      }
    }

    // CRITICAL: Verify workspace is NOT on main/master branch
    try {
      const { execSync } = await import('child_process');
      const branch = execSync('git branch --show-current', {
        cwd: workspace,
        encoding: 'utf8'
      }).trim();

      if (branch === 'main' || branch === 'master') {
        // For polyrepo workspaces, the workspace root may be on main/master
        // but sub-repos are on feature branches. Check sub-directories.
        const { readdirSync, statSync } = await import('fs');
        let hasFeatureBranch = false;
        try {
          const entries = readdirSync(workspace);
          for (const entry of entries) {
            const subPath = join(workspace, entry);
            if (statSync(subPath).isDirectory() && existsSync(join(subPath, '.git'))) {
              const subBranch = execSync('git branch --show-current', {
                cwd: subPath,
                encoding: 'utf8'
              }).trim();
              if (subBranch !== 'main' && subBranch !== 'master' && subBranch.length > 0) {
                hasFeatureBranch = true;
                spinner.text = `Found polyrepo workspace — sub-repo ${entry} on branch: ${subBranch}`;
                break;
              }
            }
          }
        } catch { /* ignore sub-repo check errors */ }

        if (!hasFeatureBranch) {
          const repairedBranch = await repairMainBranchWorkspace(workspace, normalizedId);
          if (repairedBranch) {
            spinner.text = `Moved clean workspace to branch: ${repairedBranch}`;
          } else {
            await failPostCreateValidation({
              spinner,
              issueId: id,
              projectRoot,
              workspaceCreatedThisRun,
              message: `Workspace is on ${branch} branch`,
              printDetails: () => {
                console.log('');
                console.log(chalk.red('CRITICAL: Work agents must NOT run on main/master branch.'));
                console.log(chalk.red('This bypasses the entire review/test/merge workflow.'));
                console.log('');
                console.log(chalk.bold('To fix:'));
                console.log(`  1. Create a proper workspace: ${chalk.cyan(`pan workspace ${id}`)}`);
                console.log(`  2. Or checkout a feature branch: ${chalk.cyan(`git checkout -b feature/${normalizedId}`)}`);
              },
            });
          }
        }
      } else {
        spinner.text = `Found workspace on branch: ${branch}`;
      }
    } catch (e) {
      // If git check fails, continue but warn
      spinner.warn('Could not verify branch - ensure you are NOT on main');
    }

    spinner.text = `Found workspace: ${workspace}`;

    if (options.dryRun) {
      spinner.info('Dry run mode');
      console.log('');
      console.log(chalk.bold('Would create:'));
      console.log(`  Agent ID:   agent-${normalizedId}`);
      console.log(`  Workspace:  ${workspace}`);
      console.log(`  Model:      ${options.model}`);

      // Show what context would be included
      const planningContext = await readPlanningContext(workspace);
      const taskCount = readWorkspacePlanSync(workspace)?.plan.items.length ?? 0;
      const hasPreWorkspacePRD = await Effect.runPromise(hasPRDDraft(id));
      console.log('');
      console.log(chalk.bold('Context:'));
      console.log(`  Planning:   ${planningContext ? 'Found (.pan/continue.json)' : 'None'}`);
      console.log(`  Tasks:      ${taskCount} checklist items`);
      if (hasPreWorkspacePRD) {
        console.log(`  Pre-workspace PRD: ${chalk.green('✓')} ${getPRDDraftPathSync(id)}`);
      }
      return;
    }

    // Validate continue file belongs to this issue (prevent cross-contamination from git merges)
    spinner.text = 'Validating workspace state...';
    const stateValidation = validateAndCleanStateFile(workspace, id);
    if (stateValidation.removed) {
      spinner.warn(`Cleaned stale planning state from ${stateValidation.wrongIssue}`);
    }

    // Validate spec.vbrief.json belongs to this issue (prevent stale workspace plan state from the wrong issue)
    const planValidation = validatePlanMatchesIssue(workspace, id);
    if (!planValidation.valid) {
      await failPostCreateValidation({
        spinner,
        issueId: id,
        projectRoot,
        workspaceCreatedThisRun,
        message: `Workspace planning artifacts are for ${planValidation.wrongIssue}, not ${id}`,
        printDetails: () => {
          console.log('');
          console.log(chalk.red(`The workspace contains a stale plan from a different issue.`));
          if (workspaceExisted) {
            console.log(chalk.dim(`This can happen when a workspace is reused or a branch is repurposed.`));
            console.log('');
            console.log(chalk.bold('To fix this:'));
            console.log(`  ${chalk.cyan(`1. Clean the workspace planning artifacts`)}`);
            console.log(`  ${chalk.cyan(`2. Run planning again: pan plan ${id}`)}`);
          } else {
            console.log(chalk.dim(`A freshly-created workspace inherited the wrong .pan/spec.vbrief.json from the project tree.`));
            console.log('');
            console.log(chalk.bold('To fix this:'));
            console.log(`  ${chalk.cyan(`1. Remove workspace-only .pan/spec.vbrief.json from the main worktree`)}`);
            console.log(`  ${chalk.cyan(`2. Ensure .pan/spec.vbrief.json is ignored`)}`);
            console.log(`  ${chalk.cyan(`3. Run planning again: pan plan ${id}`)}`);
          }
        },
      });
    }

    if (options.auto && !findPlanSync(workspace)) {
      spinner.text = `Synthesizing minimal vBRIEF for ${id}...`;
      const issue = await fetchIssueForAutoStart(id);
      await Effect.runPromise(writeAutoStartVBrief(projectRoot, workspace, issue));
    }

    if (!findPlanSync(workspace)) {
      await failPostCreateValidation({
        spinner,
        issueId: id,
        projectRoot,
        workspaceCreatedThisRun,
        message: `The required vBRIEF checklist for ${id} is missing or unreadable`,
        printDetails: () => {
          console.log(chalk.dim(`Run \`pan plan ${id}\` and finalize a readable implementation plan before starting work.`));
        },
      });
    }

    spinner.text = 'Building agent prompt with planning context...';
    const trackerContext = await getTrackerContext(id, workspace);
    const prompt = await buildWorkAgentPrompt({ issueId: id, env: 'LOCAL', workspacePath: workspace, projectRoot, trackerContext });

    spinner.text = 'Spawning agent...';

    // `pan start --host --yes` does not attach to the work-agent tmux session.
    // After spawnAgent finishes session creation, this command only prints the
    // details below and exits; any remaining pre-spawn delay is tracker/prompt work.
    if (shouldClearPauseBeforeSpawn) {
      clearAgentPausedSync(agentId);
    }

    const agent = await spawnAgent({
      issueId: id,
      workspace,
      harness: requestedHarness,
      model: spawnModel,
      role: 'work',
      prompt,
      allowHost: options.host,
      effort: resolvedEffort,
    });

    if (agent.role === 'work' && agent.kickoffDelivered === false) {
      spinner.fail(`Agent spawned but kickoff delivery was not confirmed: ${agent.id}`);
      for (const line of ['', chalk.red(`Kickoff delivery did not land for ${agent.id}.`), chalk.dim('The live session is preserved and the agent may be idle until the kickoff lands.'), chalk.dim('Deacon will retry delivery after the stuck threshold, or you can send a manual message now:'), `  pan tell ${id} "continue from your kickoff brief"`]) console.log(line);
      process.exitCode = 1; return;
    }

    spinner.succeed(`Agent spawned: ${agent.id}`);

    try {
      const transition = await Effect.runPromise(transitionVBriefOnMain(
        projectRoot,
        id,
        'active',
        'approved',
        `scope: approve ${id.toUpperCase()} vBRIEF`,
      ));
      if (transition.moved) {
        console.log(chalk.green(`  ✓ vBRIEF moved ${transition.fromDir} → active`));
      }
    } catch (err: any) {
      console.warn(chalk.dim(`  ⚠ Could not update main vBRIEF lifecycle: ${err?.message ?? String(err)}`));
    }

    const spawnedPlanPath = findPlanSync(workspace);
    if (spawnedPlanPath) {
      try {
        updatePlanStatus(spawnedPlanPath, 'running');
      } catch (err: any) {
        console.warn(chalk.dim(`  ⚠ Could not set workspace vBRIEF status=running: ${err?.message ?? String(err)}`));
      }
    }

    const skipTrackerUpdate = await Effect.runPromise(shouldSkipTrackerUpdate(id, options.shadow));

    if (skipTrackerUpdate) {
      await Effect.runPromise(createShadowState(id, 'open', 'pan start'));
      await Effect.runPromise(updateShadowState(id, 'in_progress', 'pan start'));
      console.log(chalk.cyan(`  👻 Shadow mode: tracking status locally`));
    }

    console.log('');
    console.log(chalk.bold('Agent Details:'));
    console.log(`  Session:    ${chalk.cyan(agent.id)}`);
    console.log(`  Workspace:  ${workspace}`);
    console.log(`  Harness:    ${agent.harness ?? 'claude-code'}`);
    console.log(`  Model:      ${agent.model}`);
    console.log(`  Role:       ${agent.role}`);
    if (resolvedEffort) console.log(`  Effort:     ${resolvedEffort}`);
    const planningContext = await readPlanningContext(workspace);
    const taskCount = readWorkspacePlanSync(workspace)?.plan.items.length ?? 0;
    if (planningContext || taskCount > 0) {
      console.log('');
      console.log(chalk.bold('Context Loaded:'));
      if (planningContext) console.log(`  Planning:   ${chalk.green('✓')} continue.json`);
      if (taskCount > 0) console.log(`  Tasks:      ${chalk.green('✓')} ${taskCount} checklist items`);
    }

    console.log('');
    console.log(chalk.dim('Commands:'));
    console.log(`  Attach:   tmux attach -t ${agent.id}`);
    console.log(`  Message:  pan tell ${id} "your message"`);
    console.log(`  Kill:     pan kill ${id}`);

  } catch (error: any) {
    spinner.fail(error.message);
    process.exit(1);
  }
}

export const __testInternals = {
  failPostCreateValidation,
  repairMainBranchWorkspace,
  resolveExplicitHarnessFlag,
};
