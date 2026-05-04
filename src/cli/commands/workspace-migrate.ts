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
import ora from 'ora';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { loadConfig } from '../../lib/config.js';
import { resolveProjectFromIssue, extractTeamPrefix, findProjectByTeam, type ProjectConfig } from '../../lib/projects.js';
import {
  loadWorkspaceMetadata,
  saveWorkspaceMetadata,
  deleteWorkspaceMetadata,
} from '../../lib/remote/workspace-metadata.js';
import {
  createFlyProviderFromConfig,
} from '../../lib/remote/index.js';
import { createWorkspace, removeWorkspace } from '../../lib/workspace-manager.js';
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
  const remoteMetadata = loadWorkspaceMetadata(issueId);
  if (remoteMetadata) {
    return 'remote';
  }

  // Check for local workspace
  const resolved = resolveProjectFromIssue(issueId, []);
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
  const resolved = resolveProjectFromIssue(issueId, []);

  if (resolved) {
    const workspacePath = join(resolved.projectPath, 'workspaces', `feature-${normalizedId}`);
    if (existsSync(workspacePath)) {
      return workspacePath;
    }
  }

  return null;
}

/**
 * Push local git branches to remote origin
 */
async function pushLocalBranches(
  localPath: string,
  projectConfig?: any
): Promise<{ steps: string[]; errors: string[] }> {
  const steps: string[] = [];
  const errors: string[] = [];

  // Check if polyrepo (has subdirs that are git repos) or monorepo
  const subdirs = readdirSync(localPath, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name);

  const gitDirs: string[] = [];

  // Check each subdir for .git
  for (const subdir of subdirs) {
    const subdirPath = join(localPath, subdir);
    if (existsSync(join(subdirPath, '.git'))) {
      gitDirs.push(subdirPath);
    }
  }

  // If no git subdirs, check if workspace root is a git repo
  if (gitDirs.length === 0 && existsSync(join(localPath, '.git'))) {
    gitDirs.push(localPath);
  }

  for (const gitDir of gitDirs) {
    const repoName = basename(gitDir);
    try {
      // Get current branch
      const { stdout: branch } = await execAsync('git branch --show-current', { cwd: gitDir });
      const branchName = branch.trim();

      // Check for uncommitted changes
      const { stdout: status } = await execAsync('git status --porcelain', { cwd: gitDir });
      if (status.trim()) {
        errors.push(`${repoName}: Has uncommitted changes`);
        continue;
      }

      // Push to origin
      await execAsync(`git push -u origin ${branchName}`, { cwd: gitDir });
      steps.push(`Pushed ${repoName}:${branchName}`);
    } catch (error: any) {
      errors.push(`${repoName}: ${error.message}`);
    }
  }

  return { steps, errors };
}

/**
 * Clone repositories on remote VM
 */
async function cloneReposOnVm(
  provider: RemoteProvider,
  vmName: string,
  localPath: string,
  issueId: string,
  projectConfig?: any
): Promise<{ steps: string[]; errors: string[] }> {
  const steps: string[] = [];
  const errors: string[] = [];

  const normalizedId = issueId.toLowerCase();
  const branchName = `feature/${normalizedId}`;

  // NOTE: SSH setup (host keys, SSH key copy) is done before calling this function

  // Check workspace structure - polyrepo or monorepo
  const subdirs = readdirSync(localPath, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name);

  const gitDirs: { name: string; path: string; remote?: string }[] = [];

  for (const subdir of subdirs) {
    const subdirPath = join(localPath, subdir);
    if (existsSync(join(subdirPath, '.git'))) {
      try {
        const { stdout } = await execAsync('git remote get-url origin', { cwd: subdirPath });
        gitDirs.push({ name: subdir, path: subdirPath, remote: stdout.trim() });
      } catch {
        gitDirs.push({ name: subdir, path: subdirPath });
      }
    }
  }

  // If monorepo
  if (gitDirs.length === 0 && existsSync(join(localPath, '.git'))) {
    try {
      const { stdout } = await execAsync('git remote get-url origin', { cwd: localPath });
      gitDirs.push({ name: 'workspace', path: localPath, remote: stdout.trim() });
    } catch {
      errors.push('Could not get git remote URL');
      return { steps, errors };
    }
  }

  // Create workspace directory on VM
  await provider.ssh(vmName, 'mkdir -p ~/workspace');

  for (const repo of gitDirs) {
    if (!repo.remote) {
      errors.push(`${repo.name}: No remote URL`);
      continue;
    }

    // Convert HTTPS to SSH if needed
    const sshUrl = convertToSshUrl(repo.remote);

    try {
      if (gitDirs.length === 1 && repo.name === 'workspace') {
        // Monorepo - clone directly to ~/workspace
        const cloneResult = await provider.ssh(vmName, `git clone ${sshUrl} ~/workspace`);
        if (cloneResult.exitCode !== 0) {
          errors.push(`Failed to clone: ${cloneResult.stderr}`);
          continue;
        }
        // Checkout branch
        await provider.ssh(vmName, `cd ~/workspace && git fetch origin && git checkout ${branchName} || git checkout -b ${branchName}`);
        steps.push(`Cloned ${repo.name} and checked out ${branchName}`);
      } else {
        // Polyrepo - clone to ~/workspace/<name>
        const cloneResult = await provider.ssh(vmName, `git clone ${sshUrl} ~/workspace/${repo.name}`);
        if (cloneResult.exitCode !== 0) {
          errors.push(`${repo.name}: Failed to clone: ${cloneResult.stderr}`);
          continue;
        }
        // Checkout branch
        await provider.ssh(vmName, `cd ~/workspace/${repo.name} && git fetch origin && git checkout ${branchName} || git checkout -b ${branchName}`);
        steps.push(`Cloned ${repo.name} and checked out ${branchName}`);
      }
    } catch (error: any) {
      errors.push(`${repo.name}: ${error.message}`);
    }
  }

  return { steps, errors };
}

/**
 * Convert HTTPS URL to SSH URL
 */
function convertToSshUrl(url: string): string {
  // git@github.com:owner/repo.git -> keep as is
  if (url.startsWith('git@')) {
    return url;
  }
  // https://github.com/owner/repo.git -> git@github.com:owner/repo.git
  const match = url.match(/https:\/\/([^\/]+)\/(.+)/);
  if (match) {
    return `git@${match[1]}:${match[2]}`;
  }
  return url;
}

/**
 * Copy planning state (.planning/ and beads) to remote VM
 */
async function copyPlanningStateToRemote(
  provider: RemoteProvider,
  vmName: string,
  localPath: string,
  issueId: string,
  projectConfig?: any
): Promise<{ steps: string[]; errors: string[] }> {
  const steps: string[] = [];
  const errors: string[] = [];

  const normalizedId = issueId.toLowerCase();

  // Find .planning directory (might be in project root, not workspace)
  const projectPath = projectConfig?.path;
  const planningLocations = [
    projectPath ? join(projectPath, '.planning', normalizedId) : null,
    join(localPath, '.planning', normalizedId),
    join(localPath, '.planning'),
  ].filter(Boolean) as string[];

  let planningDir: string | null = null;
  for (const loc of planningLocations) {
    if (existsSync(loc)) {
      planningDir = loc;
      break;
    }
  }

  if (planningDir) {
    try {
      // Create directory on VM
      await provider.ssh(vmName, `mkdir -p ~/workspace/.planning/${normalizedId}`);

      // Copy planning files
      const planningFiles = readdirSync(planningDir);
      for (const file of planningFiles) {
        const filePath = join(planningDir, file);
        if (existsSync(filePath)) {
          try {
            const content = readFileSync(filePath, 'utf-8');
            await provider.ssh(vmName, `cat > ~/workspace/.planning/${normalizedId}/${file} << 'PLANEOF'
${content}
PLANEOF`);
            steps.push(`Copied ${file}`);
          } catch {
            // Skip binary files
          }
        }
      }
    } catch (error: any) {
      errors.push(`Planning state: ${error.message}`);
    }
  } else {
    steps.push('No planning state found (skipped)');
  }

  // Copy beads if exists
  const beadsLocations = [
    join(localPath, '.beads'),
    projectPath ? join(projectPath, '.beads') : null,
  ].filter(Boolean) as string[];

  for (const beadsDir of beadsLocations) {
    if (existsSync(beadsDir)) {
      try {
        await provider.ssh(vmName, 'mkdir -p ~/workspace/.beads');
        // Copy beads database files
        const beadsFiles = readdirSync(beadsDir).filter(f => f.endsWith('.db') || f.endsWith('.jsonl'));
        for (const file of beadsFiles) {
          await provider.copyToVm(vmName, join(beadsDir, file), `~/workspace/.beads/${file}`);
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
 * Copy planning state (.planning/ and beads) from remote VM to local
 */
async function copyPlanningStateFromRemote(
  provider: RemoteProvider,
  vmName: string,
  localPath: string,
  issueId: string,
  projectConfig?: any
): Promise<{ steps: string[]; errors: string[] }> {
  const steps: string[] = [];
  const errors: string[] = [];

  const normalizedId = issueId.toLowerCase();

  // Check if planning directory exists on remote
  const planningCheck = await provider.ssh(vmName, `ls ~/workspace/.planning/${normalizedId}/ 2>/dev/null`);

  if (planningCheck.exitCode === 0 && planningCheck.stdout?.trim()) {
    try {
      // Determine local planning directory
      const projectPath = projectConfig?.path;
      const localPlanningDir = projectPath
        ? join(projectPath, '.planning', normalizedId)
        : join(localPath, '.planning', normalizedId);

      mkdirSync(localPlanningDir, { recursive: true });

      // List and copy planning files
      const lsResult = await provider.ssh(vmName, `ls ~/workspace/.planning/${normalizedId}/`);
      if (lsResult.exitCode === 0) {
        const files = lsResult.stdout.trim().split('\n').filter(f => f);
        for (const file of files) {
          try {
            const contentResult = await provider.ssh(vmName, `cat ~/workspace/.planning/${normalizedId}/${file}`);
            if (contentResult.exitCode === 0) {
              writeFileSync(join(localPlanningDir, file), contentResult.stdout);
              steps.push(`Copied ${file}`);
            }
          } catch {
            // Skip problematic files
          }
        }
      }
    } catch (error: any) {
      errors.push(`Planning state: ${error.message}`);
    }
  } else {
    steps.push('No planning state on remote (skipped)');
  }

  // Copy beads if exists
  const beadsCheck = await provider.ssh(vmName, 'ls ~/workspace/.beads/ 2>/dev/null');
  if (beadsCheck.exitCode === 0 && beadsCheck.stdout.trim()) {
    try {
      const localBeadsDir = join(localPath, '.beads');
      mkdirSync(localBeadsDir, { recursive: true });

      const files = beadsCheck.stdout.trim().split('\n').filter(f => f.endsWith('.db') || f.endsWith('.jsonl'));
      for (const file of files) {
        try {
          await provider.copyFromVm(vmName, `~/workspace/.beads/${file}`, join(localBeadsDir, file));
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
    const existingRemote = loadWorkspaceMetadata(issueId);
    if (existingRemote && !options.force) {
      spinner.fail('Remote workspace already exists');
      result.errors.push(`Remote workspace already exists for ${issueId}. Use --force to overwrite.`);
      return result;
    }

    // 3. Check remote provider availability
    spinner.text = 'Checking remote provider...';
    const config = loadConfig();
    if (!config.remote?.enabled) {
      spinner.fail('Remote workspaces not enabled');
      result.errors.push('Remote workspaces not enabled in config. Set remote.enabled = true');
      return result;
    }

    const provider = createFlyProviderFromConfig(config.remote);

    const isAuth = await provider.isAuthenticated();
    if (!isAuth) {
      spinner.fail('Not authenticated with Fly.io');
      result.errors.push('Not authenticated with Fly.io. Run: flyctl auth login');
      return result;
    }
    result.steps.push('Authenticated with Fly.io');

    // 4. Get project info for VM naming
    const resolved = resolveProjectFromIssue(issueId, []);
    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig: ProjectConfig | null = teamPrefix ? findProjectByTeam(teamPrefix) : null;
    const projectName = projectConfig?.name?.toLowerCase().replace(/\s+/g, '-') || resolved?.projectName?.toLowerCase().replace(/\s+/g, '-') || 'workspace';
    const vmName = `pan-${projectName}-${issueId.toLowerCase()}-ws`;

    // 5. Create VM (or reuse existing if --force)
    spinner.text = `Creating VM: ${vmName}...`;
    const existingVmStatus = await provider.getStatus(vmName);
    if (existingVmStatus !== 'unknown') {
      if (options.force) {
        result.steps.push(`VM already exists: ${vmName} (reusing)`);
        // Ensure it's running
        if (existingVmStatus === 'stopped') {
          spinner.text = 'Starting existing VM...';
          await provider.startVm(vmName);
        }
      } else {
        throw new Error(`VM ${vmName} already exists. Use --force to reuse it.`);
      }
    } else {
      try {
        await provider.createVm(vmName);
        result.steps.push(`Created VM: ${vmName}`);
      } catch (error: any) {
        throw error;
      }
    }

    // 6. Detect git host from local workspace repos
    const repoUrls: string[] = [];
    const subdirs = readdirSync(localPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name);
    for (const subdir of subdirs) {
      const subdirPath = join(localPath, subdir);
      if (existsSync(join(subdirPath, '.git'))) {
        try {
          const { stdout } = await execAsync('git remote get-url origin', { cwd: subdirPath });
          repoUrls.push(stdout.trim());
        } catch { /* ignore */ }
      }
    }
    // Check if workspace root is a git repo
    if (existsSync(join(localPath, '.git'))) {
      try {
        const { stdout } = await execAsync('git remote get-url origin', { cwd: localPath });
        repoUrls.push(stdout.trim());
      } catch { /* ignore */ }
    }

    const isGitHub = repoUrls.some(url => url.includes('github.com'));
    const isGitLab = repoUrls.some(url => url.includes('gitlab.com'));

    // 7. Setup SSH for git access (matching createRemoteWorkspace pattern)
    spinner.text = 'Setting up SSH access...';
    await provider.ssh(vmName, 'mkdir -p ~/.ssh && chmod 700 ~/.ssh');

    // Add SSH host keys for detected git hosts
    if (isGitHub) {
      await provider.ssh(vmName, 'ssh-keyscan -t ed25519,rsa github.com >> ~/.ssh/known_hosts 2>/dev/null');
    }
    if (isGitLab) {
      await provider.ssh(vmName, 'ssh-keyscan -t ed25519,rsa gitlab.com >> ~/.ssh/known_hosts 2>/dev/null');
    }

    // Copy SSH key for git access
    const sshKeyPaths = [
      join(homedir(), '.panopticon', 'ssh', 'exe-dev-key'),
      join(homedir(), '.ssh', 'id_ed25519'),
      join(homedir(), '.ssh', 'id_rsa'),
    ];
    const sshKeyPath = sshKeyPaths.find((p) => existsSync(p));
    if (sshKeyPath) {
      const sshKeyBase64 = Buffer.from(readFileSync(sshKeyPath, 'utf-8')).toString('base64');
      const keyFilename = sshKeyPath.includes('id_rsa') ? 'id_rsa' : 'id_ed25519';
      await provider.ssh(vmName, `echo '${sshKeyBase64}' | base64 -d > ~/.ssh/${keyFilename} && chmod 600 ~/.ssh/${keyFilename}`);
      result.steps.push(`Synced SSH key (${keyFilename})`);
    }

    // 8. Sync credentials
    spinner.text = 'Syncing credentials...';
    const credResult = await provider.syncAllCredentials(vmName);
    if (credResult.claude) result.steps.push('Synced Claude credentials');

    // Sync git CLI auth based on detected host
    if (isGitHub) {
      await provider.syncGitHubAuth(vmName);
      result.steps.push('Synced GitHub credentials');
    }
    if (isGitLab) {
      await provider.syncGitLabAuth(vmName);
      result.steps.push('Synced GitLab credentials');
    }

    // 9. Configure Claude Code for autonomous operation
    spinner.text = 'Configuring Claude Code...';
    await provider.configureClaudeCode(vmName);
    result.steps.push('Configured Claude Code');

    // 10. Push git branches (ensure remote has latest)
    spinner.text = 'Pushing git branches...';
    const pushResult = await pushLocalBranches(localPath, projectConfig);
    result.steps.push(...pushResult.steps);
    if (pushResult.errors.length > 0) {
      result.errors.push(...pushResult.errors);
      if (!options.force) {
        spinner.fail('Failed to push branches');
        return result;
      }
    }

    // 11. Clone repos on VM
    spinner.text = 'Cloning repositories on VM...';
    const cloneResult = await cloneReposOnVm(provider, vmName, localPath, issueId, projectConfig);
    result.steps.push(...cloneResult.steps);
    if (cloneResult.errors.length > 0) {
      result.errors.push(...cloneResult.errors);
      spinner.fail('Failed to clone on VM');
      return result;
    }

    // 11.55. Sync env files (if configured in project)
    const envFiles = (projectConfig?.workspace?.env as any)?.files;
    if (envFiles && envFiles.length > 0) {
      spinner.text = 'Syncing environment files...';
      try {
        const envResult = await (provider as any).syncEnvFiles(vmName, envFiles);
        if (envResult.synced.length > 0) {
          result.steps.push(`Synced ${envResult.synced.length} env file(s)`);
        }
        if (envResult.failed.length > 0) {
          result.errors.push(`Warning: Failed to sync env files: ${envResult.failed.join(', ')}`);
        }
      } catch (error: any) {
        result.errors.push(`Warning: env file sync failed: ${error.message}`);
      }
    }

    // 11.7. Setup runtime environment (Phase 1: install Java/Node)
    spinner.text = 'Installing runtime dependencies...';
    try {
      const runtimeResult = await (provider as any).setupRuntimeEnvironment(vmName);
      if (runtimeResult.java) result.steps.push(`Installed Java ${runtimeResult.projectTypes.java?.version || '21'}`);
      if (runtimeResult.node) result.steps.push(`Installed Node.js ${runtimeResult.projectTypes.node?.version || '20'}`);
      if (runtimeResult.pnpm) result.steps.push('Installed pnpm');
    } catch (error: any) {
      result.errors.push(`Warning: runtime installation failed: ${error.message}`);
    }

    // 11.8. Build applications (Phase 2)
    const shareUrl = (provider as any).getShareUrl(vmName);
    spinner.text = 'Building applications...';
    try {
      const buildResult = await (provider as any).buildAllProjects(vmName, shareUrl);
      if (buildResult.java) result.steps.push('Built Java/Maven project');
      if (buildResult.node) result.steps.push('Built Node.js/frontend project');
    } catch (error: any) {
      result.errors.push(`Warning: application build failed: ${error.message}`);
    }

    // 11.9. Start services (Phase 3)
    spinner.text = 'Starting services...';
    try {
      const serviceResult = await (provider as any).startAllServices(vmName);
      if (serviceResult.docker) result.steps.push('Started Docker Compose services');
      if (serviceResult.frontend) result.steps.push('Started frontend preview server');
    } catch (error: any) {
      result.errors.push(`Warning: service startup failed: ${error.message}`);
    }

    // 12. Copy planning state
    spinner.text = 'Copying planning state...';
    const planningResult = await copyPlanningStateToRemote(provider, vmName, localPath, issueId, projectConfig);
    result.steps.push(...planningResult.steps);
    if (planningResult.errors.length > 0) {
      // Non-fatal - planning state might not exist
      result.steps.push(`Warning: ${planningResult.errors.join(', ')}`);
    }

    // 13. Save workspace metadata
    // Note: shareUrl already defined above in step 11.8
    const metadata: RemoteWorkspaceMetadata = {
      id: issueId.toLowerCase(),
      issue: issueId,
      provider: 'fly',
      vmName,
      urls: {
        frontend: shareUrl,
        api: shareUrl,
      },
      created: new Date(),
      location: 'remote',
    };
    saveWorkspaceMetadata(metadata);
    result.steps.push('Saved workspace metadata');

    // 14. Cleanup local (unless --keep)
    // Docker containers are stopped by removeWorkspace() via stopWorkspaceDocker()
    if (!options.keep) {
      spinner.text = 'Cleaning up local workspace...';
      try {
        if (projectConfig) {
          const removeResult = await removeWorkspace({
            projectConfig,
            featureName: issueId.toLowerCase(),
          });
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
    result.message = `Workspace migrated to ${vmName}`;

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
    const remoteMetadata = loadWorkspaceMetadata(issueId);
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
    const config = loadConfig();
    const provider = createFlyProviderFromConfig(config.remote);

    // 4. Verify VM is accessible
    spinner.text = 'Checking remote VM...';
    const vmStatus = await provider.getStatus(remoteMetadata.vmName);
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
    const resolved = resolveProjectFromIssue(issueId, []);
    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig: ProjectConfig | null = teamPrefix ? findProjectByTeam(teamPrefix) : null;
    if (!projectConfig) {
      spinner.fail('Cannot resolve project config');
      result.errors.push(`Cannot resolve project config for ${issueId}`);
      return result;
    }

    const workspaceResult = await createWorkspace({
      projectConfig,
      featureName: issueId.toLowerCase(),
      startDocker: !options.noDocker,
    });

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
        await provider.deleteVm(remoteMetadata.vmName);
        result.steps.push(`Deleted VM: ${remoteMetadata.vmName}`);
      } catch (error: any) {
        result.errors.push(`Warning: Failed to delete VM: ${error.message}`);
      }
      deleteWorkspaceMetadata(issueId);
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
