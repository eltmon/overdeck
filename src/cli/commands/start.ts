import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline/promises';
import { promisify } from 'util';
import { exec, execFile, execFileSync } from 'child_process';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
import { clearAgentPaused, getAgentState, spawnAgent } from '../../lib/agents.js';
import { syncMainIntoWorkspace } from '../../lib/cloister/merge-agent.js';
import { resolveProjectFromIssue, hasProjects, listProjects, ProjectConfig } from '../../lib/projects.js';
import { hasPRDDraft, getPRDDraftPath } from '../../lib/prd-draft.js';
import { isGitHubIssue, resolveGitHubIssue } from '../../lib/tracker-utils.js';
import { Effect } from 'effect';
import { getLinearApiKey } from '../../lib/shadow-utils.js';
import { getWorkspacePanPaths } from '../../lib/pan-dir/index.js';
import { findPlan } from '../../lib/vbrief/io.js';
import { writeAutoStartVBrief, type AutoSynthesizeIssueInput } from '../../lib/vbrief/auto-synthesize.js';
import { createBeadsFromVBrief } from '../../lib/vbrief/beads.js';

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
import { loadConfig } from '../../lib/config.js';
import {
  loadWorkspaceMetadata,
  findRemoteWorkspaceMetadata,
} from '../../lib/remote/workspace-metadata.js';
import {
  spawnRemoteAgent,
  isRemoteAgentRunning,
  createFlyProviderFromConfig,
} from '../../lib/remote/index.js';
import { isRemoteAvailable } from '../../lib/remote/index.js';
import type { RemoteWorkspaceMetadata } from '../../lib/remote/interface.js';
import type { SpawnRemoteAgentOptions } from '../../lib/remote/remote-agents.js';
import { assertCanStartFresh } from '../../lib/work-agent-lifecycle.js';
import { normalizeModelOverride } from '../../lib/model-validation.js';

interface IssueOptions {
  model: string;
  /** PAN-636 — coding-agent harness override. Defaults to claude-code. */
  harness?: 'claude-code' | 'pi';
  dryRun?: boolean;
  shadow?: boolean;
  remote?: boolean;
  local?: boolean;
  auto?: boolean;
  host?: boolean;
  yes?: boolean;
  force?: boolean;
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
  const config = loadConfig();
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
    const remoteMetadata = findRemoteWorkspaceMetadata(issueId);
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
    const remoteMetadata = findRemoteWorkspaceMetadata(issueId);
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
  const resolved = resolveProjectFromIssue(issueId, labels);
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
  const github = resolveGitHubIssue(issueId);
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
    const apiKey = Effect.runSync(getLinearApiKey());
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
  const config = loadConfig();

  // Verify remote is enabled
  if (!config.remote?.enabled) {
    spinner.fail('Remote workspaces not enabled');
    console.log('');
    console.log(chalk.dim('Run: pan admin remote setup'));
    console.log(chalk.dim('This writes the required remote settings to ~/.panopticon/config.toml'));
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
  let remoteMetadata = findRemoteWorkspaceMetadata(issueId);

  // Auto-create if not found
  if (!remoteMetadata) {
    spinner.text = 'Remote workspace not found, creating...';
    try {
      const { createRemoteWorkspace } = await import('../../lib/remote-workspace.js');
      remoteMetadata = await createRemoteWorkspace(issueId, { spinner });
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

  if (options.dryRun) {
    spinner.info('Dry run mode (remote)');
    console.log('');
    console.log(chalk.bold('Would create:'));
    console.log(`  Agent ID:   ${agentId}`);
    console.log(`  VM:         ${chalk.cyan(remoteMetadata.vmName)}`);
    console.log(`  Provider:   ${remoteMetadata.provider}`);
    console.log(`  Model:      ${options.model || 'default'}`);
    return;
  }

  // Build prompt for remote agent
  spinner.text = 'Building agent prompt...';
  const projectRoot = findProjectRoot(issueId);
  const prompt = await buildWorkAgentPrompt({ issueId, env: 'REMOTE', workspacePath: '/workspace', skipDynamicContext: true });

  // Sync all credentials before spawning (tokens may have expired)
  spinner.text = 'Syncing credentials (Claude, GitHub)...';
  const fly = createFlyProviderFromConfig(config.remote);
  const credsSynced = await fly.syncAllCredentials(remoteMetadata.vmName);
  if (!credsSynced.claude) {
    spinner.warn('Could not sync Claude credentials - agent may need to re-authenticate');
  }
  if (!credsSynced.github) {
    spinner.warn('Could not sync GitHub CLI auth - gh commands may fail');
  }

  // Spawn remote agent
  spinner.text = 'Spawning remote agent...';

  try {
    if (clearPauseBeforeSpawn) {
      clearAgentPaused(agentId);
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
    });

    spinner.succeed(`Remote agent spawned: ${remoteAgent.id}`);

    // Handle shadow mode
    const skipTrackerUpdate = await shouldSkipTrackerUpdate(issueId, options.shadow);

    if (skipTrackerUpdate) {
      await createShadowState(issueId, 'open', 'pan start');
      await updateShadowState(issueId, 'in_progress', 'pan start');
      console.log(chalk.cyan(`  👻 Shadow mode: tracking status locally`));
    } else if (isGitHubIssue(issueId)) {
      // GitHub issue — add in-progress label
      const gh = resolveGitHubIssue(issueId);
      if (gh.isGitHub) {
        try {
          const { loadConfig: loadYamlConfig } = await import('../../lib/config-yaml.js');
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
      const apiKey = Effect.runSync(getLinearApiKey());
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
  const existing = findRemoteWorkspaceMetadata(issueId);
  if (existing) {
    return existing;
  }

  // Auto-create remote workspace
  spinner.text = 'Creating remote workspace...';

  const config = loadConfig();
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
    const metadata = await createRemoteWorkspace(issueId);
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
    const resolved = resolveProjectFromIssue(issueId, labels);
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
  readBeadsTasks,
} from '../../lib/cloister/work-agent-prompt.js';

/**
 * Check whether a workspace has beads tasks (planning must create them before work begins).
 * Uses `bd list` to query the beads database directly (storage-backend agnostic).
 * Exported for testing.
 */
export function countBeadsTasks(workspacePath: string, issueId?: string): number {
  const label = issueId?.toLowerCase();
  try {
    const args = label
      ? ['list', '--json', '-l', label, '--status', 'all', '--limit', '0']
      : ['list', '--json', '--limit', '0'];
    const output = execFileSync('bd', args, {
      cwd: workspacePath,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const tasks = JSON.parse(output.trim() || '[]');
    return Array.isArray(tasks) ? tasks.length : 0;
  } catch {
    const jsonlPath = join(workspacePath, '.beads', 'issues.jsonl');
    if (!existsSync(jsonlPath)) return 0;
    if (!label) return readFileSync(jsonlPath, 'utf-8').split('\n').filter((line) => line.trim()).length;

    let count = 0;
    for (const line of readFileSync(jsonlPath, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const labels: string[] = Array.isArray(entry.labels) ? entry.labels : [];
        if (labels.some((candidate) => candidate.toLowerCase() === label || candidate.toLowerCase() === `workspace:${label}`)) {
          count += 1;
        }
      } catch { /* skip malformed lines */ }
    }
    return count;
  }
}

export function hasBeadsTasks(workspacePath: string, issueId?: string): boolean {
  return countBeadsTasks(workspacePath, issueId) > 0;
}

/**
 * Validate that the resolved vBRIEF belongs to the current issue.
 * Uses findPlan (resolves main-side spec first, then workspace fallback).
 */
function validatePlanMatchesIssue(workspacePath: string, issueId: string): { valid: boolean; wrongIssue?: string } {
  const planPath = findPlan(workspacePath);

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

export function validateBeadsMatchPlan(workspacePath: string, issueId: string): { valid: boolean; beadCount: number; planItemCount: number } {
  const planPath = findPlan(workspacePath);
  const beadCount = countBeadsTasks(workspacePath, issueId);
  if (!planPath) return { valid: true, beadCount, planItemCount: 0 };

  try {
    const raw = readFileSync(planPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const planItemCount = Array.isArray(parsed?.plan?.items) ? parsed.plan.items.length : 0;
    if (planItemCount === 0) return { valid: true, beadCount, planItemCount };
    return { valid: beadCount === planItemCount, beadCount, planItemCount };
  } catch {
    return { valid: true, beadCount, planItemCount: 0 };
  }
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
  const { continuePath } = getWorkspacePanPaths(workspacePath);

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

export async function issueCommand(id: string, options: IssueOptions): Promise<void> {
  try {
    const model = normalizeModelOverride(options.model);
    if (model) options.model = model;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  if (!(await confirmHostOverride(options))) {
    process.exit(1);
  }

  // PAN-636 — validate --harness up front. canUseHarness gates the
  // {harness, model, authMode} combination; invalid combos exit non-zero
  // with the human-readable reason text on stderr (no spinner, no
  // workspace setup) so callers don't get a half-prepared workspace
  // when they pick something the gate refuses.
  const requestedHarness: 'claude-code' | 'pi' = options.harness ?? 'claude-code';
  if (requestedHarness !== 'claude-code' && requestedHarness !== 'pi') {
    process.stderr.write(`Invalid --harness value: ${options.harness}. Expected 'claude-code' or 'pi'.\n`);
    process.exit(1);
  }
  if (options.model) {
    const { canUseHarness } = await import('../../lib/harness-policy.js');
    const { getProviderAuthMode } = await import('../../lib/agents.js');
    const decision = canUseHarness(requestedHarness, options.model, await getProviderAuthMode(options.model));
    if (!decision.allowed) {
      process.stderr.write(`${decision.reason}\n`);
      process.exit(1);
    }
  }

  // Normalize issue ID (MIN-648 -> min-648 for tmux session name)
  const normalizedId = id.toLowerCase();
  const agentId = `agent-${normalizedId}`;
  const existingAgentState = getAgentState(agentId);
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

  const spinner = ora(`Preparing workspace for ${id}...`).start();

  try {

    // Determine workspace location preference
    const locationPreference = determineWorkspaceLocation(options);

    // Log project resolution info
    const resolved = resolveProjectFromIssue(id);
    if (resolved) {
      spinner.text = `Resolved project: ${resolved.projectName} (${resolved.projectPath})`;
    }

    // Find workspace (local or remote based on preference)
    const { workspacePath, isRemote } = findWorkspaceWithLocation(id, locationPreference);

    // Refuse fresh start when a resumable session already exists.
    // Users must choose resume or reset-session explicitly.
    try {
      assertCanStartFresh(id, { allowPausedForce: shouldClearPauseBeforeSpawn });
    } catch (error) {
      if (workspacePath || isRemote) {
        throw error;
      }
    }

    // Handle remote workspace
    if (isRemote || (locationPreference === 'remote' && !workspacePath)) {
      await handleRemoteWorkspace(id, options, spinner, shouldClearPauseBeforeSpawn);
      return;
    }

    // Handle local workspace
    const projectRoot = findProjectRoot(id);
    let workspace = workspacePath;
    const workspaceExisted = !!workspace;
    let workspaceCreatedThisRun = false;

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

    // If workspace was created during planning, main may have moved forward.
    // Fetch and merge latest main before the agent starts working.
    if (workspaceExisted) {
      spinner.text = 'Syncing latest main into workspace...';
      try {
        const syncResult = await syncMainIntoWorkspace(workspace, id);
        if (syncResult.success) {
          if (syncResult.alreadyUpToDate) {
            spinner.text = 'Workspace already up to date with main';
          } else {
            spinner.text = `Synced main into workspace (${syncResult.commitCount ?? 0} commit(s))`;
          }
        } else {
          spinner.warn(`Could not sync main: ${syncResult.reason || 'unknown reason'}`);
        }
      } catch (syncErr: any) {
        spinner.warn(`Sync main failed: ${syncErr.message}`);
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
      const planningContext = readPlanningContext(workspace);
      const beadsTasks = await readBeadsTasks(workspace, projectRoot, id);
      const hasPreWorkspacePRD = hasPRDDraft(id);
      console.log('');
      console.log(chalk.bold('Context:'));
      console.log(`  Planning:   ${planningContext ? 'Found (.pan/continue.json)' : 'None'}`);
      console.log(`  Beads:      ${beadsTasks.length} tasks`);
      if (hasPreWorkspacePRD) {
        console.log(`  Pre-workspace PRD: ${chalk.green('✓')} ${getPRDDraftPath(id)}`);
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

    if (options.auto && !findPlan(workspace)) {
      spinner.text = `Synthesizing minimal vBRIEF for ${id}...`;
      const issue = await fetchIssueForAutoStart(id);
      await writeAutoStartVBrief(projectRoot, workspace, issue);
      const recovery = await createBeadsFromVBrief(workspace);
      if (recovery.created.length === 0) {
        await failPostCreateValidation({
          spinner,
          issueId: id,
          projectRoot,
          workspaceCreatedThisRun,
          message: `Auto-start synthesized a vBRIEF but no beads were created for ${id}`,
          printDetails: () => {
            if (recovery.errors.length > 0) console.log(chalk.dim(`  Errors: ${recovery.errors.join(', ')}`));
          },
        });
      }
    }

    // SAFEGUARD: Require beads tasks before work begins (matches dashboard start-agent enforcement)
    if (!hasBeadsTasks(workspace, id)) {
      // If no planning was done, this is a simple issue — auto-create a bead so the agent can start
      const hasPlanningState = findPlan(workspace) !== null;
      if (!hasPlanningState) {
        spinner.text = `Auto-creating bead for simple issue ${id}...`;
        try {
          const { execSync } = require('child_process');
          execSync(`bd create "${id}: Implement issue" --type task -l "${id.toLowerCase()},difficulty:simple"`, {
            cwd: workspace,
            encoding: 'utf-8',
            timeout: 10000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch (bdErr) {
          await failPostCreateValidation({
            spinner,
            issueId: id,
            projectRoot,
            workspaceCreatedThisRun,
            message: `No beads tasks found for ${id} and auto-create failed`,
            printDetails: () => {},
          });
        }
      } else {
        // Planning was done but no beads — attempt auto-recovery from vBRIEF (matches dashboard agents.ts path)
        spinner.text = `No beads found — attempting recovery from vBRIEF plan...`;
        try {
          const { createBeadsFromVBrief } = await import('../../lib/vbrief/beads.js');
          const recovery = await createBeadsFromVBrief(workspace);
          if (recovery.created.length > 0) {
            spinner.succeed(`Recovered ${recovery.created.length} beads from vBRIEF plan`);
          } else {
            await failPostCreateValidation({
              spinner,
              issueId: id,
              projectRoot,
              workspaceCreatedThisRun,
              message: `No beads tasks found for ${id} and recovery from vBRIEF failed`,
              printDetails: () => {
                if (recovery.errors.length > 0) {
                  console.log(chalk.dim(`  Errors: ${recovery.errors.join(', ')}`));
                }
                console.log('');
                console.log(chalk.red(`Planning must create a task breakdown before work begins.`));
                console.log(chalk.dim(`Run planning again and ensure it creates beads with "bd create".`));
                console.log('');
                console.log(chalk.bold('To re-run planning:'));
                console.log(`  ${chalk.cyan(`Open the dashboard and click 'Plan' for ${id}`)}`);
              },
            });
          }
        } catch (recoveryErr: any) {
          await failPostCreateValidation({
            spinner,
            issueId: id,
            projectRoot,
            workspaceCreatedThisRun,
            message: `No beads tasks found for ${id}`,
            printDetails: () => {
              console.log(chalk.dim(`  Recovery error: ${recoveryErr.message}`));
              console.log('');
              console.log(chalk.bold('To re-run planning:'));
              console.log(`  ${chalk.cyan(`pan plan ${id}`)}`);
            },
          });
        }
      }
    }

    const beadCoverage = validateBeadsMatchPlan(workspace, id);
    if (!beadCoverage.valid) {
      await failPostCreateValidation({
        spinner,
        issueId: id,
        projectRoot,
        workspaceCreatedThisRun,
        message: `Beads count (${beadCoverage.beadCount}) does not match vBRIEF plan items (${beadCoverage.planItemCount}) for ${id}`,
        printDetails: () => {
          console.log('');
          console.log(chalk.red('Work agents require one bead per vBRIEF plan item.'));
          console.log(chalk.dim('Re-run planning finalization so beads are materialized from the current vBRIEF before starting work.'));
        },
      });
    }

    spinner.text = 'Building agent prompt with planning context...';
    const trackerContext = await getTrackerContext(id, workspace);
    const prompt = await buildWorkAgentPrompt({ issueId: id, env: 'LOCAL', workspacePath: workspace, projectRoot, trackerContext });

    spinner.text = 'Spawning agent...';

    if (shouldClearPauseBeforeSpawn) {
      clearAgentPaused(agentId);
    }

    const agent = await spawnAgent({
      issueId: id,
      workspace,
      harness: requestedHarness,
      model: options.model,
      role: 'work',
      prompt,
      allowHost: options.host,
    });

    spinner.succeed(`Agent spawned: ${agent.id}`);

    // Check shadow mode
    const skipTrackerUpdate = await shouldSkipTrackerUpdate(id, options.shadow);

    if (skipTrackerUpdate) {
      // Create shadow state instead of updating tracker
      await createShadowState(id, 'open', 'pan start');
      await updateShadowState(id, 'in_progress', 'pan start');
      console.log(chalk.cyan(`  👻 Shadow mode: tracking status locally`));
    }
    // Note: tracker transition for local agents is handled by spawnAgent() → transitionIssueToInProgress()
    // No duplicate transition needed here.

    console.log('');
    console.log(chalk.bold('Agent Details:'));
    console.log(`  Session:    ${chalk.cyan(agent.id)}`);
    console.log(`  Workspace:  ${workspace}`);
    console.log(`  Harness:    ${agent.harness ?? 'claude-code'}`);
    console.log(`  Model:      ${agent.model}`);
    console.log(`  Role:       ${agent.role}`);

    // Show context info
    const planningContext = readPlanningContext(workspace);
    const beadsTasks = await readBeadsTasks(workspace, projectRoot, id);
    if (planningContext || beadsTasks.length > 0) {
      console.log('');
      console.log(chalk.bold('Context Loaded:'));
      if (planningContext) console.log(`  Planning:   ${chalk.green('✓')} continue.json`);
      if (beadsTasks.length > 0) console.log(`  Beads:      ${chalk.green('✓')} ${beadsTasks.length} tasks`);
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
};
