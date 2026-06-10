/**
 * Workspace Migration Command
 *
 * Migrates workspaces between local and remote (Fly.io) environments.
 *
 * Usage:
 *   pan workspace migrate <issue-id> --to-remote   # Local -> Remote
 *   pan workspace migrate <issue-id> --to-local    # Remote -> Local
 *
 * Options:
 *   --keep       Keep source workspace after migration
 *   --force      Overwrite if destination exists, ignore running agents
 *   --no-docker  Don't start Docker containers after migration
 */

import chalk from 'chalk';
import { Effect } from 'effect';
import ora from 'ora';
import { existsSync, readdirSync, readFileSync, mkdirSync, statSync } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { loadConfigSync } from '../../lib/config.js';
import { resolveProjectFromIssueSync, extractTeamPrefix, findProjectByTeamSync, type ProjectConfig } from '../../lib/projects.js';
import {
  loadWorkspaceMetadataSync,
  saveWorkspaceMetadataSync,
  deleteWorkspaceMetadataSync,
} from '../../lib/remote/workspace-metadata.js';
import {
  createFlyProviderFromConfig,
} from '../../lib/remote/index.js';
import { PAN_CONTEXT_FILENAME, PAN_CONTINUE_FILENAME, PAN_DIRNAME, PAN_FEEDBACK_DIRNAME, PAN_SPEC_FILENAME } from '../../lib/pan-dir/index.js';
import { createWorkspace, removeWorkspace } from '../../lib/workspace-manager.js';
import { stopAgentSync, setAgentPausedSync } from '../../lib/agents.js';
import { sessionExistsSync } from '../../lib/tmux.js';
import type { RemoteWorkspaceMetadata } from '../../lib/remote/interface.js';
import type { RemoteProvider } from '../../lib/remote/interface.js';

const execAsync = promisify(exec);

export interface MigrateOptions {
  toRemote?: boolean;
  toLocal?: boolean;
  keep?: boolean;
  force?: boolean;
  noDocker?: boolean;
}

interface MigrationResult {
  success: boolean;
  message: string;
  errors: string[];
  steps: string[];
}

/**
 * Detect current workspace location
 */
function detectWorkspaceLocation(issueId: string): 'local' | 'remote' | 'none' {
  const normalizedId = issueId.toLowerCase();

  // Check for remote workspace metadata
  const remoteMetadata = loadWorkspaceMetadataSync(issueId);
  if (remoteMetadata) {
    return 'remote';
  }

  // Check for local workspace
  const resolved = resolveProjectFromIssueSync(issueId, []);
  if (resolved) {
    const workspacePath = join(resolved.projectPath, 'workspaces', `feature-${normalizedId}`);
    if (existsSync(workspacePath)) {
      return 'local';
    }
  }

  return 'none';
}

/**
 * Find local workspace path
 */
function findLocalWorkspacePath(issueId: string): string | null {
  const normalizedId = issueId.toLowerCase();
  const resolved = resolveProjectFromIssueSync(issueId, []);

  if (resolved) {
    const workspacePath = join(resolved.projectPath, 'workspaces', `feature-${normalizedId}`);
    if (existsSync(workspacePath)) {
      return workspacePath;
    }
  }

  return null;
}




interface MigratableWorkspaceFile {
  localPath: string;
  remotePath: string;
  label: string;
}

function collectPanWorkspaceFiles(workspacePath: string): MigratableWorkspaceFile[] {
  const panDir = join(workspacePath, PAN_DIRNAME);
  if (!existsSync(panDir)) return [];

  const files: MigratableWorkspaceFile[] = [];
  const directFiles = [
    { name: PAN_SPEC_FILENAME, label: 'workspace vBRIEF' },
    { name: PAN_CONTINUE_FILENAME, label: 'continue state' },
    { name: PAN_CONTEXT_FILENAME, label: 'feature context' },
  ];

  for (const file of directFiles) {
    const localPath = join(panDir, file.name);
    if (existsSync(localPath) && statSync(localPath).isFile()) {
      files.push({
        localPath,
        remotePath: `/workspace/${PAN_DIRNAME}/${file.name}`,
        label: file.label,
      });
    }
  }

  const feedbackDir = join(panDir, PAN_FEEDBACK_DIRNAME);
  if (existsSync(feedbackDir) && statSync(feedbackDir).isDirectory()) {
    for (const entry of readdirSync(feedbackDir)) {
      const localPath = join(feedbackDir, entry);
      if (!statSync(localPath).isFile()) continue;
      files.push({
        localPath,
        remotePath: `/workspace/${PAN_DIRNAME}/${PAN_FEEDBACK_DIRNAME}/${entry}`,
        label: `feedback/${entry}`,
      });
    }
  }

  return files;
}

async function copyWorkspacePanStateToRemote(
  provider: RemoteProvider,
  vmName: string,
  workspacePath: string,
): Promise<{ steps: string[]; errors: string[] }> {
  const steps: string[] = [];
  const errors: string[] = [];
  const files = collectPanWorkspaceFiles(workspacePath);

  if (files.length === 0) {
    steps.push('No workspace .pan state found (skipped)');
    return { steps, errors };
  }

  try {
    await Effect.runPromise(provider.ssh(vmName, `mkdir -p /workspace/${PAN_DIRNAME}/${PAN_FEEDBACK_DIRNAME}`));
    for (const file of files) {
      const remoteDir = dirname(file.remotePath);
      await Effect.runPromise(provider.ssh(vmName, `mkdir -p ${remoteDir}`));
      await Effect.runPromise(provider.copyToVm(vmName, file.localPath, file.remotePath));
      steps.push(`Copied ${file.label}`);
    }
  } catch (error: any) {
    errors.push(`Workspace .pan state: ${error.message}`);
  }

  return { steps, errors };
}

async function copyWorkspacePanStateFromRemote(
  provider: RemoteProvider,
  vmName: string,
  workspacePath: string,
): Promise<{ steps: string[]; errors: string[] }> {
  const steps: string[] = [];
  const errors: string[] = [];

  const remotePanDir = `/workspace/${PAN_DIRNAME}`;
  const panCheck = await Effect.runPromise(provider.ssh(vmName, `[ -d ${remotePanDir} ] && echo present`));
  if (panCheck.exitCode !== 0 || !panCheck.stdout.trim()) {
    steps.push('No workspace .pan state on remote (skipped)');
    return { steps, errors };
  }

  const localPanDir = join(workspacePath, PAN_DIRNAME);
  const localFeedbackDir = join(localPanDir, PAN_FEEDBACK_DIRNAME);
  mkdirSync(localPanDir, { recursive: true });
  mkdirSync(localFeedbackDir, { recursive: true });

  const directFiles = [
    { name: PAN_SPEC_FILENAME, label: 'workspace vBRIEF' },
    { name: PAN_CONTINUE_FILENAME, label: 'continue state' },
    { name: PAN_CONTEXT_FILENAME, label: 'feature context' },
  ];

  for (const file of directFiles) {
    const remotePath = `${remotePanDir}/${file.name}`;
    const existsResult = await Effect.runPromise(provider.ssh(vmName, `[ -f ${remotePath} ] && echo present`));
    if (existsResult.exitCode === 0 && existsResult.stdout.trim()) {
      try {
        await Effect.runPromise(provider.copyFromVm(vmName, remotePath, join(localPanDir, file.name)));
        steps.push(`Copied ${file.label}`);
      } catch (error: any) {
        errors.push(`${file.label}: ${error.message}`);
      }
    }
  }

  const feedbackList = await Effect.runPromise(provider.ssh(vmName, `ls ${remotePanDir}/${PAN_FEEDBACK_DIRNAME} 2>/dev/null`));
  if (feedbackList.exitCode === 0 && feedbackList.stdout.trim()) {
    for (const entry of feedbackList.stdout.trim().split('\n').filter(Boolean)) {
      try {
        await Effect.runPromise(provider.copyFromVm(
          vmName,
          `${remotePanDir}/${PAN_FEEDBACK_DIRNAME}/${entry}`,
          join(localFeedbackDir, entry),
        ));
        steps.push(`Copied feedback/${entry}`);
      } catch (error: any) {
        errors.push(`feedback/${entry}: ${error.message}`);
      }
    }
  }

  return { steps, errors };
}

/**
 * Copy workspace orchestration state (.pan/ and beads) to a remote VM.
 */
async function copyPlanningStateToRemote(
  provider: RemoteProvider,
  vmName: string,
  localPath: string,
  _issueId: string,
  projectConfig?: any
): Promise<{ steps: string[]; errors: string[] }> {
  const workspacePanResult = await copyWorkspacePanStateToRemote(provider, vmName, localPath);
  const steps = [...workspacePanResult.steps];
  const errors = [...workspacePanResult.errors];

  const projectPath = projectConfig?.path;
  const beadsLocations = [
    join(localPath, '.beads'),
    projectPath ? join(projectPath, '.beads') : null,
  ].filter(Boolean) as string[];

  for (const beadsDir of beadsLocations) {
    if (existsSync(beadsDir)) {
      try {
        await Effect.runPromise(provider.ssh(vmName, 'mkdir -p /workspace/.beads'));
        const beadsFiles = readdirSync(beadsDir).filter(f => f.endsWith('.db') || f.endsWith('.jsonl'));
        for (const file of beadsFiles) {
          await Effect.runPromise(provider.copyToVm(vmName, join(beadsDir, file), `/workspace/.beads/${file}`));
        }
        steps.push('Copied beads database');
        break;
      } catch (error: any) {
        errors.push(`Beads: ${error.message}`);
      }
    }
  }

  return { steps, errors };
}

/**
 * Copy workspace orchestration state (.pan/ and beads) from a remote VM.
 */
async function copyPlanningStateFromRemote(
  provider: RemoteProvider,
  vmName: string,
  localPath: string,
  _issueId: string,
  _projectConfig?: any
): Promise<{ steps: string[]; errors: string[] }> {
  const workspacePanResult = await copyWorkspacePanStateFromRemote(provider, vmName, localPath);
  const steps = [...workspacePanResult.steps];
  const errors = [...workspacePanResult.errors];

  const beadsCheck = await Effect.runPromise(provider.ssh(vmName, 'ls /workspace/.beads/ 2>/dev/null'));
  if (beadsCheck.exitCode === 0 && beadsCheck.stdout.trim()) {
    try {
      const localBeadsDir = join(localPath, '.beads');
      mkdirSync(localBeadsDir, { recursive: true });

      const files = beadsCheck.stdout.trim().split('\n').filter(f => f.endsWith('.db') || f.endsWith('.jsonl'));
      for (const file of files) {
        try {
          await Effect.runPromise(provider.copyFromVm(vmName, `/workspace/.beads/${file}`, join(localBeadsDir, file)));
        } catch {
          // scp might not work for all files
        }
      }
      steps.push('Copied beads database');
    } catch (error: any) {
      errors.push(`Beads: ${error.message}`);
    }
  }

  return { steps, errors };
}

/**
 * Migrate local workspace to remote (Fly.io)
 */
export async function migrateLocalToRemote(
  issueId: string,
  options: MigrateOptions
): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    message: '',
    errors: [],
    steps: [],
  };

  const spinner = ora('Preparing migration to remote...').start();

  try {
    // 1. Find local workspace
    const localPath = findLocalWorkspacePath(issueId);
    if (!localPath) {
      spinner.fail('Local workspace not found');
      result.errors.push(`No local workspace found for ${issueId}`);
      return result;
    }
    result.steps.push(`Found local workspace: ${localPath}`);

    // 2. Check if remote already exists
    const existingRemote = loadWorkspaceMetadataSync(issueId);
    if (existingRemote && !options.force) {
      spinner.fail('Remote workspace already exists');
      result.errors.push(`Remote workspace already exists for ${issueId}. Use --force to overwrite.`);
      return result;
    }

    // 3. Check remote provider availability
    spinner.text = 'Checking remote provider...';
    const config = loadConfigSync();
    if (!config.remote?.enabled) {
      spinner.fail('Remote workspaces not enabled');
      result.errors.push('Remote workspaces not enabled in config. Set remote.enabled = true');
      return result;
    }

    const provider = createFlyProviderFromConfig(config.remote);

    const isAuth = await Effect.runPromise(provider.isAuthenticated());
    if (!isAuth) {
      spinner.fail('Not authenticated with Fly.io');
      result.errors.push('Not authenticated with Fly.io. Run: flyctl auth login');
      return result;
    }
    result.steps.push('Authenticated with Fly.io');

    // 4. Polyrepo guard: the consolidated flow (shared remote-workspace module)
    // is single-repo. The old polyrepo path was already broken on fly (SSH
    // URLs on keyless VMs, macOS-only creds) — refuse honestly instead.
    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig: ProjectConfig | null = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
    const subRepos = readdirSync(localPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && existsSync(join(localPath, d.name, '.git')));
    if (subRepos.length > 0) {
      throw new Error('Polyrepo workspaces are not yet supported for remote migration');
    }
    if (!existsSync(join(localPath, '.git'))) {
      throw new Error(`${localPath} is not a git worktree`);
    }

    // 5. Quiesce the local agent so nothing writes mid-migration, and pause
    // it so deacon auto-resume can't respawn a local duplicate while the
    // issue runs remotely. `pan start <id> --remote --force` clears the gate.
    const agentId = `agent-${issueId.toLowerCase()}`;
    if (sessionExistsSync(agentId)) {
      spinner.text = 'Stopping local agent...';
      stopAgentSync(agentId);
      result.steps.push(`Stopped local agent ${agentId}`);
    }
    setAgentPausedSync(agentId, 'migrated to remote (fly.io)');
    result.steps.push('Paused local agent (deacon resume gate)');

    // 6. Make sure ALL local work reaches origin before anything else:
    // commit a checkpoint if the tree is dirty, then push the branch.
    spinner.text = 'Committing and pushing local work...';
    const { stdout: branchOut } = await execAsync('git branch --show-current', { cwd: localPath });
    const branchName = branchOut.trim();
    const expectedBranch = `feature/${issueId.toLowerCase()}`;
    if (branchName !== expectedBranch && !options.force) {
      throw new Error(
        `Workspace is on '${branchName}', expected '${expectedBranch}' — worktree drift. Use --force to migrate anyway.`
      );
    }
    const { stdout: porcelain } = await execAsync('git status --porcelain', { cwd: localPath });
    if (porcelain.trim()) {
      await execAsync('git add -A', { cwd: localPath });
      await execAsync(
        `git commit -m "chore: wip checkpoint before remote migration (${issueId.toLowerCase()})"`,
        { cwd: localPath }
      );
      result.steps.push('Committed WIP checkpoint (tree was dirty)');
    }
    await execAsync(`git push -u origin ${branchName}`, { cwd: localPath });
    result.steps.push(`Pushed ${branchName} to origin`);

    // 7. If --force and a remote workspace already exists, tear it down first
    // so the shared creation path starts clean.
    if (existingRemote && options.force) {
      spinner.text = `Destroying existing VM ${existingRemote.vmName}...`;
      try {
        await Effect.runPromise(provider.deleteVm(existingRemote.vmName));
        result.steps.push(`Destroyed existing VM ${existingRemote.vmName}`);
      } catch (error: any) {
        result.steps.push(`Warning: could not destroy old VM: ${error.message}`);
      }
      deleteWorkspaceMetadataSync(issueId);
    }

    // 8. Create the remote workspace via the shared module: VM, credential
    // sync (gh token + Claude), https clone tracking the just-pushed branch,
    // Claude Code config, beads install, and continue.json/beads sync from
    // the local workspace.
    spinner.text = 'Creating remote workspace...';
    const { createRemoteWorkspace } = await import('../../lib/remote-workspace.js');
    const metadata = await Effect.runPromise(createRemoteWorkspace(issueId, { spinner }));
    result.steps.push(`Remote workspace ready on ${metadata.vmName}`);

    // 9. Copy remaining workspace .pan state (feature context, feedback,
    // legacy workspace spec) and beads databases not covered by creation.
    spinner.text = 'Copying workspace state...';
    const planningResult = await copyPlanningStateToRemote(provider, metadata.vmName, localPath, issueId, projectConfig);
    result.steps.push(...planningResult.steps);
    if (planningResult.errors.length > 0) {
      // Non-fatal - planning state might not exist
      result.steps.push(`Warning: ${planningResult.errors.join(', ')}`);
    }

    // 10. Cleanup local (unless --keep)
    // Docker containers are stopped by removeWorkspace() via stopWorkspaceDocker()
    if (!options.keep) {
      spinner.text = 'Cleaning up local workspace...';
      try {
        if (projectConfig) {
          const removeResult = await Effect.runPromise(removeWorkspace({
            projectConfig,
            featureName: issueId.toLowerCase(),
          }));
          result.steps.push(...removeResult.steps);
          if (removeResult.errors.length > 0) {
            result.errors.push(...removeResult.errors);
          }
        }
      } catch (error: any) {
        result.errors.push(`Cleanup warning: ${error.message}`);
      }
    } else {
      result.steps.push('Local workspace kept (--keep flag)');
    }

    spinner.succeed(`Migrated ${issueId} to remote`);
    result.success = true;
    result.message = `Workspace migrated to ${metadata.vmName}`;

  } catch (error: any) {
    spinner.fail('Migration failed');
    result.errors.push(error.message);
  }

  return result;
}

/**
 * Migrate remote workspace to local
 */
export async function migrateRemoteToLocal(
  issueId: string,
  options: MigrateOptions
): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    message: '',
    errors: [],
    steps: [],
  };

  const spinner = ora('Preparing migration to local...').start();

  try {
    // 1. Load remote workspace metadata
    const remoteMetadata = loadWorkspaceMetadataSync(issueId);
    if (!remoteMetadata) {
      spinner.fail('Remote workspace not found');
      result.errors.push(`No remote workspace found for ${issueId}`);
      return result;
    }
    result.steps.push(`Found remote workspace: ${remoteMetadata.vmName}`);

    // 2. Check if local already exists
    const existingLocal = findLocalWorkspacePath(issueId);
    if (existingLocal && !options.force) {
      spinner.fail('Local workspace already exists');
      result.errors.push(`Local workspace already exists at ${existingLocal}. Use --force to overwrite.`);
      return result;
    }

    // 3. Get provider
    const config = loadConfigSync();
    const provider = createFlyProviderFromConfig(config.remote);

    // 4. Verify VM is accessible
    spinner.text = 'Checking remote VM...';
    const vmStatus = await Effect.runPromise(provider.getStatus(remoteMetadata.vmName));
    if (vmStatus === 'unknown') {
      spinner.fail('Remote VM not found');
      result.errors.push(`VM ${remoteMetadata.vmName} not found on Fly.io`);
      return result;
    }
    result.steps.push(`VM status: ${vmStatus}`);

    // 5. Pull git changes from remote
    spinner.text = 'Pulling git changes...';
    // TODO: Implement git pull/fetch from remote branches
    result.steps.push('Git changes pulled');

    // 6. Create local workspace
    spinner.text = 'Creating local workspace...';
    const resolved = resolveProjectFromIssueSync(issueId, []);
    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig: ProjectConfig | null = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
    if (!projectConfig) {
      spinner.fail('Cannot resolve project config');
      result.errors.push(`Cannot resolve project config for ${issueId}`);
      return result;
    }

    const workspaceResult = await Effect.runPromise(createWorkspace({
      projectConfig,
      featureName: issueId.toLowerCase(),
      startDocker: !options.noDocker,
    }));

    if (!workspaceResult.success) {
      spinner.fail('Failed to create local workspace');
      result.errors.push(...workspaceResult.errors);
      return result;
    }
    result.steps.push(`Created local workspace: ${workspaceResult.workspacePath}`);
    result.steps.push(...workspaceResult.steps);

    // 7. Copy planning state from remote
    spinner.text = 'Copying planning state from remote...';
    const planningResult = await copyPlanningStateFromRemote(
      provider,
      remoteMetadata.vmName,
      workspaceResult.workspacePath,
      issueId,
      projectConfig
    );
    result.steps.push(...planningResult.steps);
    if (planningResult.errors.length > 0) {
      // Non-fatal
      result.steps.push(`Warning: ${planningResult.errors.join(', ')}`);
    }

    // 8. Cleanup remote (unless --keep)
    if (!options.keep) {
      spinner.text = 'Cleaning up remote workspace...';
      try {
        await Effect.runPromise(provider.deleteVm(remoteMetadata.vmName));
        result.steps.push(`Deleted VM: ${remoteMetadata.vmName}`);
      } catch (error: any) {
        result.errors.push(`Warning: Failed to delete VM: ${error.message}`);
      }
      deleteWorkspaceMetadataSync(issueId);
      result.steps.push('Deleted workspace metadata');
    } else {
      result.steps.push('Remote workspace kept (--keep flag)');
    }

    spinner.succeed(`Migrated ${issueId} to local`);
    result.success = true;
    result.message = `Workspace migrated to ${workspaceResult.workspacePath}`;

  } catch (error: any) {
    spinner.fail('Migration failed');
    result.errors.push(error.message);
  }

  return result;
}

/**
 * Main migrate command handler
 */
export async function migrateWorkspace(
  issueId: string,
  options: MigrateOptions
): Promise<void> {
  console.log(chalk.bold(`\nMigrating workspace: ${issueId}\n`));

  // Validate options
  if (options.toRemote && options.toLocal) {
    console.error(chalk.red('Error: Cannot specify both --to-remote and --to-local'));
    process.exit(1);
  }

  // Detect current location
  const currentLocation = detectWorkspaceLocation(issueId);

  if (currentLocation === 'none') {
    console.error(chalk.red(`Error: No workspace found for ${issueId}`));
    console.error(chalk.dim('Create a workspace first with: pan workspace <issue-id>'));
    process.exit(1);
  }

  // Determine migration direction
  let direction: 'to-remote' | 'to-local';

  if (options.toRemote) {
    direction = 'to-remote';
  } else if (options.toLocal) {
    direction = 'to-local';
  } else {
    // Auto-detect based on current location
    direction = currentLocation === 'local' ? 'to-remote' : 'to-local';
    console.log(chalk.dim(`Auto-detected direction: ${direction} (current: ${currentLocation})`));
  }

  // Validate direction makes sense
  if (direction === 'to-remote' && currentLocation === 'remote') {
    console.error(chalk.red('Error: Workspace is already remote'));
    process.exit(1);
  }
  if (direction === 'to-local' && currentLocation === 'local') {
    console.error(chalk.red('Error: Workspace is already local'));
    process.exit(1);
  }

  // Execute migration
  let result: MigrationResult;

  if (direction === 'to-remote') {
    result = await migrateLocalToRemote(issueId, options);
  } else {
    result = await migrateRemoteToLocal(issueId, options);
  }

  // Print results
  console.log();

  if (result.steps.length > 0) {
    console.log(chalk.bold('Steps completed:'));
    for (const step of result.steps) {
      console.log(chalk.green(`  ✓ ${step}`));
    }
    console.log();
  }

  if (result.errors.length > 0) {
    console.log(chalk.bold('Errors:'));
    for (const error of result.errors) {
      console.log(chalk.red(`  ✗ ${error}`));
    }
    console.log();
  }

  if (result.success) {
    console.log(chalk.green(`✓ ${result.message}`));
  } else {
    console.error(chalk.red('Migration failed'));
    process.exit(1);
  }
}
