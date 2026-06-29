import chalk from 'chalk';
import type { Ora } from 'ora';
import ora from 'ora';
import { exec } from 'child_process';
import { existsSync, readFileSync, realpathSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { Effect } from 'effect';
import { buildClaudeUserSettingsSync } from '../../lib/claude-permissions.js';
import { loadConfigSync } from '../../lib/config.js';
import {
  extractTeamPrefix,
  findProjectByTeamSync,
  getIssuePrefix,
} from '../../lib/projects.js';
import { createFlyProviderFromConfig, isRemoteAvailable } from '../../lib/remote/index.js';
import type { RemoteWorkspaceMetadata } from '../../lib/remote/interface.js';
import {
  saveWorkspaceMetadataSync,
  loadWorkspaceMetadataSync,
  WORKSPACES_DIR,
} from '../../lib/remote/workspace-metadata.js';

const execAsync = promisify(exec);

interface CreateOptions {
  dryRun?: boolean;
}

interface DestroyOptions {
  force?: boolean;
}

/**
 * Convert HTTPS git URLs to SSH format for remote VM cloning
 * Remote VMs use SSH keys for authentication, not HTTPS credentials
 *
 * Examples:
 *   https://github.com/owner/repo.git → git@github.com:owner/repo.git
 *   https://gitlab.com/owner/repo.git → git@gitlab.com:owner/repo.git
 */
function convertToSshUrl(httpsUrl: string): string {
  // Match common HTTPS git URL patterns
  const httpsPattern = /^https:\/\/([^/]+)\/(.+?)(?:\.git)?$/;
  const match = httpsUrl.match(httpsPattern);

  if (match) {
    const [, host, path] = match;
    // Ensure .git suffix
    const repoPath = path.endsWith('.git') ? path : `${path}.git`;
    return `git@${host}:${repoPath}`;
  }

  // Already SSH format or unrecognized - return as-is
  return httpsUrl;
}

/**
 * Create a remote workspace on Fly.io
 */
export async function createRemoteWorkspace(
  issueId: string,
  normalizedId: string,
  branchName: string,
  spinner: Ora,
  options: CreateOptions
): Promise<void> {
  const config = loadConfigSync();
  const remoteConfig = config.remote;

  if (!remoteConfig?.enabled) {
    spinner.fail('Remote workspaces not enabled');
    console.log('');
    console.log(chalk.dim('Run: pan remote setup'));
    process.exit(1);
  }

  // Check availability
  const availability = await isRemoteAvailable();
  if (!availability.available) {
    spinner.fail('Remote not available');
    console.log('');
    console.log(chalk.yellow(availability.reason || 'Unknown error'));
    process.exit(1);
  }

  const fly = createFlyProviderFromConfig(remoteConfig);

  // Determine project context first (needed for VM naming)
  const teamPrefix = extractTeamPrefix(issueId);
  const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
  const projectRoot = projectConfig?.path || process.cwd();

  // Determine project identifier for VM name
  // Priority: team prefix from issue > linear_team from project > repo name
  let projectId = teamPrefix?.toLowerCase();
  if (!projectId && projectConfig && getIssuePrefix(projectConfig)) {
    projectId = getIssuePrefix(projectConfig)!.toLowerCase();
  }
  if (!projectId) {
    // Fall back to git repo name
    try {
      const { stdout } = await execAsync('git remote get-url origin', {
        cwd: projectRoot,
        encoding: 'utf-8',
      });
      const repoMatch = stdout.trim().match(/\/([^\/]+?)(\.git)?$/);
      projectId = repoMatch ? repoMatch[1].toLowerCase().replace(/[^a-z0-9-]/g, '-') : 'proj';
    } catch {
      projectId = 'proj';
    }
  }

  // VM names must be valid hostnames (start with letter, alphanumeric + hyphens)
  // Include project ID to avoid collisions across projects
  const vmName = `${projectId}-${normalizedId}-ws`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  if (options.dryRun) {
    spinner.info('Dry run - would create remote workspace');
    console.log('');
    console.log(chalk.bold('Would create:'));
    console.log(`  VM:        ${chalk.cyan(vmName)}`);
    console.log(`  Project:   ${chalk.dim(projectId)}`);
    console.log(`  Branch:    ${chalk.dim(branchName)}`);
    return;
  }

  try {
    // Step 1: Create VM
    spinner.text = 'Creating VM (this may take 1-2 minutes)...';
    const vmInfo = await Effect.runPromise(fly.createVm(vmName));

    // Get git remote URL
    let repoUrl = '';
    try {
      const { stdout } = await execAsync('git remote get-url origin', {
        cwd: projectRoot,
        encoding: 'utf-8',
      });
      repoUrl = stdout.trim();
    } catch {
      spinner.fail('Could not determine git remote URL');
      console.log('');
      console.log(chalk.dim('Make sure you are in a git repository with a remote origin.'));
      // Clean up VM
      await Effect.runPromise(fly.deleteVm(vmName));
      process.exit(1);
    }

    // Step 3: Add SSH host keys and clone repository on VM
    spinner.text = 'Cloning repository on VM...';

    // Detect git host from repo URL
    const isGitHub = repoUrl.includes('github.com');
    const isGitLab = repoUrl.includes('gitlab.com');
    const gitHost = isGitHub ? 'github.com' : isGitLab ? 'gitlab.com' : null;

    // Add SSH host keys to known_hosts for the detected host
    await Effect.runPromise(fly.ssh(vmName, 'mkdir -p ~/.ssh && chmod 700 ~/.ssh'));
    if (gitHost) {
      await Effect.runPromise(fly.ssh(vmName, `ssh-keyscan -t ed25519,rsa ${gitHost} >> ~/.ssh/known_hosts 2>/dev/null`));
    }

    // Inject SSH key for git access if available
    // Check multiple locations: overdeck-specific key first, then standard SSH keys
    const sshKeyPaths = [
      join(homedir(), '.overdeck', 'ssh', 'exe-dev-key'),
      join(homedir(), '.ssh', 'id_ed25519'),
      join(homedir(), '.ssh', 'id_rsa'),
    ];
    const sshKeyPath = sshKeyPaths.find((p) => existsSync(p));
    if (sshKeyPath) {
      const sshKeyBase64 = Buffer.from(readFileSync(sshKeyPath, 'utf-8')).toString('base64');
      // Determine key type from filename for remote VM
      const keyFilename = sshKeyPath.includes('id_rsa') ? 'id_rsa' : 'id_ed25519';
      await Effect.runPromise(fly.ssh(vmName, `echo '${sshKeyBase64}' | base64 -d > ~/.ssh/${keyFilename} && chmod 600 ~/.ssh/${keyFilename}`));
    }

    // Sync git CLI auth for the detected host
    if (isGitHub) {
      // GitHub: sync gh CLI auth
      await fly.syncGitHubAuth(vmName);
    } else if (isGitLab) {
      // GitLab: sync glab CLI auth
      spinner.text = 'Syncing GitLab credentials...';
      await fly.syncGitLabAuth(vmName);
    }

    // Check if this is a polyrepo project
    const isPolyrepo = projectConfig?.workspace?.type === 'polyrepo' && projectConfig.workspace.repos;

    if (isPolyrepo) {
      // Polyrepo: Clone each repo separately
      spinner.text = 'Cloning repositories (polyrepo)...';
      await Effect.runPromise(fly.ssh(vmName, 'mkdir -p ~/workspace'));

      for (const repo of projectConfig!.workspace!.repos!) {
        spinner.text = `Cloning ${repo.name}...`;

        // Resolve symlink to get actual repo path
        const rawRepoPath = join(projectRoot, repo.path);
        const actualRepoPath = existsSync(rawRepoPath) ? realpathSync(rawRepoPath) : rawRepoPath;

        // Get git remote URL for this repo
        let repoRemoteUrl: string;
        try {
          const { stdout } = await execAsync('git remote get-url origin', {
            cwd: actualRepoPath,
            encoding: 'utf-8',
          });
          repoRemoteUrl = convertToSshUrl(stdout.trim());
        } catch (err) {
          throw new Error(`Failed to get remote URL for ${repo.name} at ${actualRepoPath}: ${err}`);
        }

        // Clone this repo on the remote VM
        const cloneResult = await Effect.runPromise(fly.ssh(vmName, `git clone ${repoRemoteUrl} ~/workspace/${repo.name}`));
        if (cloneResult.exitCode !== 0) {
          throw new Error(`Failed to clone ${repo.name}: ${cloneResult.stderr}`);
        }

        // Create feature branch for this repo
        const repoBranchPrefix = repo.branch_prefix || 'feature/';
        const repoBranchName = `${repoBranchPrefix}${normalizedId}`;
        const branchResult = await Effect.runPromise(fly.ssh(vmName, `cd ~/workspace/${repo.name} && git checkout -b ${repoBranchName}`));
        if (branchResult.exitCode !== 0) {
          // Branch might already exist remotely
          await Effect.runPromise(fly.ssh(vmName, `cd ~/workspace/${repo.name} && git checkout ${repoBranchName} || git checkout -b ${repoBranchName}`));
        }
      }

      spinner.text = 'Setting up workspace structure...';
    } else {
      // Single repo: use existing logic
      // Convert HTTPS URLs to SSH format for remote VM cloning
      // Remote VMs use SSH keys, not interactive HTTPS credentials
      const sshRepoUrl = convertToSshUrl(repoUrl);

      const cloneResult = await Effect.runPromise(fly.ssh(vmName, `git clone ${sshRepoUrl} ~/workspace`));
      if (cloneResult.exitCode !== 0) {
        throw new Error(`Failed to clone: ${cloneResult.stderr}`);
      }

      // Step 4: Create feature branch
      spinner.text = 'Creating feature branch...';
      const branchResult = await Effect.runPromise(fly.ssh(vmName, `cd ~/workspace && git checkout -b ${branchName}`));
      if (branchResult.exitCode !== 0) {
        // Branch might already exist remotely
        await Effect.runPromise(fly.ssh(vmName, `cd ~/workspace && git checkout ${branchName} || git checkout -b ${branchName}`));
      }
    }

    // Step 4.5: Create /workspace symlink for consistent paths
    await Effect.runPromise(fly.ssh(vmName, `sudo ln -sf ~/workspace /workspace 2>/dev/null || true`));

    // Step 4.6: Configure Claude Code - copy credentials and skip onboarding
    spinner.text = 'Configuring Claude Code...';
    await Effect.runPromise(fly.ssh(vmName, `mkdir -p ~/.claude`));

    // Copy credentials from macOS Keychain to remote
    try {
      const { stdout: credentials } = await execAsync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: 'utf-8' }
      );
      if (credentials && credentials.trim()) {
        const credsBase64 = Buffer.from(credentials.trim()).toString('base64');
        await Effect.runPromise(fly.ssh(vmName, `echo '${credsBase64}' | base64 -d > ~/.claude/.credentials.json`));
      }
    } catch {
      spinner.warn('Could not copy Claude credentials - you may need to login on the VM');
    }

    // Set onboarding complete in ~/.claude.json (NOT ~/.claude/settings.json!)
    // This is the file Claude Code checks for onboarding status
    const onboardingPatch = `
import json
import os
path = os.path.expanduser("~/.claude.json")
data = {}
if os.path.exists(path):
    with open(path, "r") as f:
        data = json.load(f)
data["hasCompletedOnboarding"] = True
data["lastOnboardingVersion"] = "2.0.50"
with open(path, "w") as f:
    json.dump(data, f, indent=2)
`;
    const patchBase64 = Buffer.from(onboardingPatch).toString('base64');
    await Effect.runPromise(fly.ssh(vmName, `echo '${patchBase64}' | base64 -d | python3`));

    // Write ~/.claude/settings.json on the remote VM honoring the user's
    // Overdeck permission mode. defaultMode here is what `claude` uses when
    // an invocation omits --permission-mode; hardcoding 'bypassPermissions'
    // would silently escalate any unflagged claude invocation on the VM
    // (interactive shells, future helper scripts) even when the user chose Auto.
    const claudeSettings = JSON.stringify(buildClaudeUserSettingsSync());
    const settingsBase64 = Buffer.from(claudeSettings).toString('base64');
    await Effect.runPromise(fly.ssh(vmName, `echo '${settingsBase64}' | base64 -d > ~/.claude/settings.json`));

    // Configure Claude Code for autonomous operation (onboarding-complete + permission mode per user setting)
    await fly.configureClaudeCode(vmName);

    // Step 4.7: Copy essential skills to remote VM
    spinner.text = 'Copying skills to remote VM...';
    await fly.copySkillsToVm(vmName);

    // Step 5: Install beads CLI on remote VM
    spinner.text = 'Installing beads CLI...';
    const bdInstalled = await fly.installBeads(vmName);
    if (bdInstalled) {
      await fly.initBeads(vmName, '~/workspace');
    }

    // Step 6: Save workspace metadata
    const metadata: RemoteWorkspaceMetadata = {
      id: normalizedId,
      issue: issueId.toUpperCase(),
      provider: 'fly',
      vmName,
      machineId: vmInfo.machineId,
      appName: fly.getAppName(),
      urls: {},
      created: new Date(),
      location: 'remote',
    };

    saveWorkspaceMetadataSync(metadata);

    spinner.succeed('Remote workspace created!');

    console.log('');
    console.log(chalk.bold('Workspace Details:'));
    console.log(`  Issue:    ${chalk.green(issueId.toUpperCase())}`);
    console.log(`  VM:       ${chalk.cyan(vmName)}`);
    console.log(`  Branch:   ${chalk.dim(branchName)}`);
    console.log(`  Location: ${chalk.yellow('Remote (Fly.io)')}`);
    console.log('');

    console.log(chalk.bold('Commands:'));
    console.log(`  SSH:    ${chalk.dim(`pan workspace ssh ${issueId}`)}`);
    console.log(`  Stop:   ${chalk.dim(`pan workspace stop ${issueId}`)}`);
    console.log(`  Delete: ${chalk.dim(`pan workspace destroy ${issueId}`)}`);
    console.log('');

  } catch (error: any) {
    spinner.fail(`Failed to create remote workspace: ${error.message}`);
    // Try to clean up
    try {
      await Effect.runPromise(fly.deleteVm(vmName));
    } catch {
      // Ignore cleanup errors
    }
    process.exit(1);
  }
}

/**
 * Migrate workspace between local and remote
 */
interface MigrateOptions {
  to?: 'local' | 'remote';
  keep?: boolean;
  force?: boolean;
}

export async function migrateCommand(issueId: string, options: MigrateOptions): Promise<void> {
  if (options.to && options.to !== 'remote' && options.to !== 'local') {
    console.error(chalk.red('Invalid --to value. Use "remote" or "local".'));
    process.exit(1);
  }
  const { migrateWorkspace } = await import('./workspace-migrate.js');
  await migrateWorkspace(issueId, {
    toRemote: options.to === 'remote',
    toLocal: options.to === 'local',
    keep: options.keep,
    force: options.force,
  });
}

/**
 * Sync Claude Code credentials to remote workspace
 */
export async function syncAuthCommand(issueId: string): Promise<void> {
  const spinner = ora('Syncing credentials...').start();

  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadata = loadWorkspaceMetadataSync(normalizedId);

  if (!metadata || metadata.location !== 'remote') {
    spinner.fail(`No remote workspace found for ${issueId}`);
    console.log(chalk.dim('Create one with: pan workspace create --remote ' + issueId));
    process.exit(1);
  }

  try {
    const fly = createFlyProviderFromConfig(loadConfigSync().remote);

    // Sync all credentials (Claude, GitHub, etc.)
    const synced = await fly.syncAllCredentials(metadata.vmName);

    const allSynced = synced.claude && synced.github;
    if (allSynced) {
      spinner.succeed('All credentials synced to remote workspace');
      console.log(chalk.dim(`  VM: ${metadata.vmName}`));
      console.log(chalk.dim(`  Claude: ✓  GitHub: ✓`));
    } else {
      spinner.warn('Some credentials could not be synced');
      console.log(chalk.dim(`  VM: ${metadata.vmName}`));
      console.log(chalk.dim(`  Claude: ${synced.claude ? '✓' : '✗'}  GitHub: ${synced.github ? '✓' : '✗'}`));
      console.log('');
      if (!synced.claude) {
        console.log(chalk.yellow('Claude Code credentials not found in Keychain.'));
        console.log(chalk.dim('You may need to authenticate Claude Code locally first:'));
        console.log(chalk.dim('  claude --help'));
      }
      if (!synced.github) {
        console.log(chalk.yellow('GitHub CLI auth not found in Keychain.'));
        console.log(chalk.dim('You may need to authenticate GitHub CLI locally first:'));
        console.log(chalk.dim('  gh auth login'));
      }
      console.log('');
      console.log(chalk.dim('Or SSH into the VM and authenticate directly:'));
      console.log(chalk.dim(`  pan workspace ssh ${issueId}`));
    }
  } catch (error: any) {
    spinner.fail(`Failed to sync credentials: ${error.message}`);
    process.exit(1);
  }
}

/**
 * SSH into remote workspace
 */
export async function sshCommand(issueId: string): Promise<void> {
  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadata = loadWorkspaceMetadataSync(normalizedId);

  if (!metadata || metadata.location !== 'remote') {
    console.error(chalk.red(`No remote workspace found for ${issueId}`));
    console.log(chalk.dim('Create one with: pan workspace create --remote ' + issueId));
    process.exit(1);
  }

  const { spawn } = await import('child_process');

  // Spawn interactive SSH session via Fly CLI
  const appName = metadata.appName || 'pan-workspaces';
  const child = spawn('fly', ['ssh', 'console', '-a', appName], {
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

/**
 * Start a stopped remote workspace
 */
export async function startCommand(issueId: string): Promise<void> {
  const spinner = ora('Starting workspace...').start();

  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadata = loadWorkspaceMetadataSync(normalizedId);

  if (!metadata || metadata.location !== 'remote') {
    spinner.fail(`No remote workspace found for ${issueId}`);
    process.exit(1);
  }

  try {
    const fly = createFlyProviderFromConfig(loadConfigSync().remote);
    await Effect.runPromise(fly.startVm(metadata.vmName));

    spinner.succeed(`Workspace ${issueId} started`);

    if (metadata.urls.frontend) {
      console.log(`  Frontend: ${chalk.cyan(metadata.urls.frontend)}`);
    }
    if (metadata.urls.api) {
      console.log(`  API:      ${chalk.cyan(metadata.urls.api)}`);
    }

  } catch (error: any) {
    spinner.fail(`Failed to start: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Stop (hibernate) a remote workspace
 */
export async function stopCommand(issueId: string): Promise<void> {
  const spinner = ora('Stopping workspace...').start();

  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadata = loadWorkspaceMetadataSync(normalizedId);

  if (!metadata || metadata.location !== 'remote') {
    spinner.fail(`No remote workspace found for ${issueId}`);
    process.exit(1);
  }

  try {
    const fly = createFlyProviderFromConfig(loadConfigSync().remote);

    // Stop VM
    spinner.text = 'Hibernating VM...';
    await Effect.runPromise(fly.stopVm(metadata.vmName));

    spinner.succeed(`Workspace ${issueId} stopped (hibernated)`);
    console.log(chalk.dim('  Start again with: pan workspace start ' + issueId));

  } catch (error: any) {
    spinner.fail(`Failed to stop: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Destroy a remote workspace
 */
export async function destroyRemoteWorkspace(
  issueId: string,
  normalizedId: string,
  metadata: RemoteWorkspaceMetadata,
  spinner: Ora,
  options: DestroyOptions
): Promise<void> {
  const fly = createFlyProviderFromConfig(loadConfigSync().remote);

  try {
    // Step 1: Kill any running agent
    spinner.text = 'Stopping agent...';
    const agentId = `agent-${normalizedId}`;
    const { killRemoteAgent } = await import('../../lib/remote/remote-agents.js');
    await killRemoteAgent(agentId, metadata.vmName);

    // Step 2: Delete VM
    spinner.text = 'Deleting VM...';
    await Effect.runPromise(fly.deleteVm(metadata.vmName));

    // Step 3: Remove workspace metadata file
    const metadataFile = join(WORKSPACES_DIR, `${normalizedId}.yaml`);
    if (existsSync(metadataFile)) {
      rmSync(metadataFile);
    }

    spinner.succeed(`Remote workspace ${issueId} destroyed`);
    console.log('');
    console.log(chalk.dim('  VM deleted, metadata removed.'));

  } catch (error: any) {
    spinner.fail(`Failed to destroy remote workspace: ${error.message}`);
    if (!options.force) {
      console.log(chalk.dim('  Tip: Use --force to forcefully clean up'));
    }
    process.exit(1);
  }
}
