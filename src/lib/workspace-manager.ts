/**
 * Workspace Manager
 *
 * Handles workspace creation and removal for both monorepo and polyrepo projects.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, symlinkSync, chmodSync } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  ProjectConfig,
  WorkspaceConfig,
  TemplatePlaceholders,
  replacePlaceholders,
  getDefaultWorkspaceConfig,
} from './workspace-config.js';

const execAsync = promisify(exec);

export interface WorkspaceCreateOptions {
  projectConfig: ProjectConfig;
  featureName: string;
  startDocker?: boolean;
  dryRun?: boolean;
}

export interface WorkspaceCreateResult {
  success: boolean;
  workspacePath: string;
  errors: string[];
  steps: string[];
}

/**
 * Create placeholders for template substitution
 */
function createPlaceholders(
  projectConfig: ProjectConfig,
  featureName: string,
  workspacePath: string
): TemplatePlaceholders {
  const featureFolder = `feature-${featureName}`;
  const domain = projectConfig.workspace?.dns?.domain || 'localhost';

  return {
    FEATURE_NAME: featureName,
    FEATURE_FOLDER: featureFolder,
    BRANCH_NAME: `feature/${featureName}`,
    COMPOSE_PROJECT: `${basename(projectConfig.path)}-${featureFolder}`,
    DOMAIN: domain,
    PROJECT_NAME: basename(projectConfig.path),
    PROJECT_PATH: projectConfig.path,
    WORKSPACE_PATH: workspacePath,
  };
}

/**
 * Validate feature name (alphanumeric and hyphens only)
 */
function validateFeatureName(name: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(name);
}

/**
 * Create a git worktree
 */
async function createWorktree(
  repoPath: string,
  targetPath: string,
  branchName: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Fetch latest from origin
    await execAsync('git fetch origin', { cwd: repoPath });

    // Check if branch exists locally or remotely
    const { stdout: localBranches } = await execAsync('git branch --list', { cwd: repoPath });
    const { stdout: remoteBranches } = await execAsync('git branch -r --list', { cwd: repoPath });

    const branchExists =
      localBranches.includes(branchName) ||
      remoteBranches.includes(`origin/${branchName}`);

    if (branchExists) {
      await execAsync(`git worktree add "${targetPath}" "${branchName}"`, { cwd: repoPath });
    } else {
      await execAsync(`git worktree add "${targetPath}" -b "${branchName}" main`, { cwd: repoPath });
    }

    return { success: true, message: `Created worktree at ${targetPath}` };
  } catch (error) {
    return { success: false, message: `Failed to create worktree: ${error}` };
  }
}

/**
 * Remove a git worktree
 */
async function removeWorktree(
  repoPath: string,
  targetPath: string,
  branchName: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Remove worktree
    await execAsync(`git worktree remove "${targetPath}" --force`, { cwd: repoPath }).catch(() => {});

    // Optionally delete the branch
    await execAsync(`git branch -D "${branchName}"`, { cwd: repoPath }).catch(() => {});

    return { success: true, message: `Removed worktree at ${targetPath}` };
  } catch (error) {
    return { success: false, message: `Failed to remove worktree: ${error}` };
  }
}

/**
 * Add DNS entry to ~/.wsl2hosts
 */
function addWsl2HostEntry(hostname: string): boolean {
  const wsl2hostsPath = join(homedir(), '.wsl2hosts');

  try {
    let content = '';
    if (existsSync(wsl2hostsPath)) {
      content = readFileSync(wsl2hostsPath, 'utf-8');
    }

    if (!content.includes(hostname)) {
      writeFileSync(wsl2hostsPath, content + (content.endsWith('\n') ? '' : '\n') + hostname + '\n');
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove DNS entry from ~/.wsl2hosts
 */
function removeWsl2HostEntry(hostname: string): boolean {
  const wsl2hostsPath = join(homedir(), '.wsl2hosts');

  try {
    if (!existsSync(wsl2hostsPath)) return true;

    let content = readFileSync(wsl2hostsPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() !== hostname);
    writeFileSync(wsl2hostsPath, lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Sync DNS to Windows hosts file via PowerShell
 */
async function syncDnsToWindows(): Promise<boolean> {
  try {
    await execAsync('powershell.exe -Command "Start-ScheduledTask -TaskName \'SyncMynHosts\'"');
    return true;
  } catch {
    return false;
  }
}

/**
 * Assign a port from a range
 */
function assignPort(
  portFile: string,
  featureFolder: string,
  range: [number, number]
): number {
  // Ensure port file exists
  if (!existsSync(portFile)) {
    mkdirSync(dirname(portFile), { recursive: true });
    writeFileSync(portFile, '');
  }

  const content = readFileSync(portFile, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  // Check if already assigned
  for (const line of lines) {
    const [folder, port] = line.split(':');
    if (folder === featureFolder) {
      return parseInt(port, 10);
    }
  }

  // Find next available port
  const usedPorts = new Set(lines.map(l => parseInt(l.split(':')[1], 10)));
  for (let port = range[0]; port <= range[1]; port++) {
    if (!usedPorts.has(port)) {
      writeFileSync(portFile, content + (content.endsWith('\n') ? '' : '\n') + `${featureFolder}:${port}\n`);
      return port;
    }
  }

  throw new Error(`No available ports in range ${range[0]}-${range[1]}`);
}

/**
 * Release a port assignment
 */
function releasePort(portFile: string, featureFolder: string): boolean {
  try {
    if (!existsSync(portFile)) return true;

    let content = readFileSync(portFile, 'utf-8');
    const lines = content.split('\n').filter(line => !line.startsWith(`${featureFolder}:`));
    writeFileSync(portFile, lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Process template files with placeholder replacement
 */
function processTemplates(
  templateDir: string,
  targetDir: string,
  placeholders: TemplatePlaceholders,
  templates?: Array<{ source: string; target: string }>
): string[] {
  const steps: string[] = [];

  if (!existsSync(templateDir)) {
    return steps;
  }

  // If specific templates are defined, process those
  if (templates && templates.length > 0) {
    for (const { source, target } of templates) {
      const sourcePath = join(templateDir, source);
      const targetPath = join(targetDir, target);

      if (existsSync(sourcePath)) {
        const content = readFileSync(sourcePath, 'utf-8');
        const processed = replacePlaceholders(content, placeholders);
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, processed);
        steps.push(`Processed template: ${source} -> ${target}`);
      }
    }
  } else {
    // Process all .template files
    const files = readdirSync(templateDir);
    for (const file of files) {
      if (file.endsWith('.template')) {
        const sourcePath = join(templateDir, file);
        const targetPath = join(targetDir, file.replace('.template', ''));

        const content = readFileSync(sourcePath, 'utf-8');
        const processed = replacePlaceholders(content, placeholders);
        writeFileSync(targetPath, processed);
        steps.push(`Processed template: ${file}`);
      }
    }
  }

  return steps;
}

/**
 * Create symlinks for shared directories
 */
function createSymlinks(
  sourceDir: string,
  targetDir: string,
  symlinks: string[]
): string[] {
  const steps: string[] = [];

  for (const symlink of symlinks) {
    const sourcePath = join(sourceDir, symlink);
    const targetPath = join(targetDir, symlink);

    if (existsSync(sourcePath)) {
      mkdirSync(dirname(targetPath), { recursive: true });
      try {
        symlinkSync(sourcePath, targetPath);
        steps.push(`Created symlink: ${symlink}`);
      } catch {
        // Symlink might already exist
      }
    }
  }

  return steps;
}

/**
 * Create a workspace
 */
export async function createWorkspace(options: WorkspaceCreateOptions): Promise<WorkspaceCreateResult> {
  const { projectConfig, featureName, startDocker, dryRun } = options;
  const result: WorkspaceCreateResult = {
    success: true,
    workspacePath: '',
    errors: [],
    steps: [],
  };

  // Validate feature name
  if (!validateFeatureName(featureName)) {
    result.success = false;
    result.errors.push('Invalid feature name. Use alphanumeric and hyphens only.');
    return result;
  }

  // Reject 'main' as feature name
  if (featureName === 'main') {
    result.success = false;
    result.errors.push('Cannot create workspace for "main". Use base repos directly.');
    return result;
  }

  const workspaceConfig = projectConfig.workspace || getDefaultWorkspaceConfig();
  const workspacesDir = join(projectConfig.path, workspaceConfig.workspaces_dir || 'workspaces');
  const featureFolder = `feature-${featureName}`;
  const workspacePath = join(workspacesDir, featureFolder);
  result.workspacePath = workspacePath;

  // Check if workspace already exists
  if (existsSync(workspacePath)) {
    result.success = false;
    result.errors.push(`Workspace already exists at ${workspacePath}`);
    return result;
  }

  if (dryRun) {
    result.steps.push('[DRY RUN] Would create workspace at: ' + workspacePath);
    return result;
  }

  // Create placeholders
  const placeholders = createPlaceholders(projectConfig, featureName, workspacePath);

  // Create workspace directory
  mkdirSync(workspacePath, { recursive: true });
  result.steps.push('Created workspace directory');

  // Handle polyrepo vs monorepo
  if (workspaceConfig.type === 'polyrepo' && workspaceConfig.repos) {
    // Create worktrees for each repo
    for (const repo of workspaceConfig.repos) {
      const repoPath = join(projectConfig.path, repo.path);
      const targetPath = join(workspacePath, repo.name);
      const branchPrefix = repo.branch_prefix || 'feature/';
      const branchName = `${branchPrefix}${featureName}`;

      const worktreeResult = await createWorktree(repoPath, targetPath, branchName);
      if (worktreeResult.success) {
        result.steps.push(`Created worktree for ${repo.name}: ${branchName}`);
      } else {
        result.errors.push(worktreeResult.message);
      }
    }
  } else {
    // Monorepo: create single worktree
    const branchName = `feature/${featureName}`;
    const worktreeResult = await createWorktree(projectConfig.path, workspacePath, branchName);
    if (worktreeResult.success) {
      result.steps.push(`Created worktree: ${branchName}`);
    } else {
      result.errors.push(worktreeResult.message);
    }
  }

  // Configure DNS
  if (workspaceConfig.dns) {
    for (const entryPattern of workspaceConfig.dns.entries) {
      const hostname = replacePlaceholders(entryPattern, placeholders);

      if (workspaceConfig.dns.sync_method === 'wsl2hosts' || !workspaceConfig.dns.sync_method) {
        if (addWsl2HostEntry(hostname)) {
          result.steps.push(`Added DNS entry: ${hostname}`);
        }
      }
    }

    // Sync to Windows if on WSL2
    if (process.platform === 'linux') {
      const synced = await syncDnsToWindows();
      if (synced) {
        result.steps.push('Synced DNS to Windows hosts file');
      }
    }
  }

  // Assign ports
  if (workspaceConfig.ports) {
    for (const [portName, portConfig] of Object.entries(workspaceConfig.ports)) {
      const portFile = join(projectConfig.path, `.${portName}-ports`);
      try {
        const port = assignPort(portFile, featureFolder, portConfig.range);
        result.steps.push(`Assigned ${portName} port: ${port}`);
        // Add to placeholders for use in templates
        (placeholders as any)[`${portName.toUpperCase()}_PORT`] = String(port);
      } catch (error) {
        result.errors.push(`Failed to assign ${portName} port: ${error}`);
      }
    }
  }

  // Process agent templates
  if (workspaceConfig.agent?.template_dir) {
    const templateDir = join(projectConfig.path, workspaceConfig.agent.template_dir);

    // Process template files
    const templateSteps = processTemplates(
      templateDir,
      workspacePath,
      placeholders,
      workspaceConfig.agent.templates
    );
    result.steps.push(...templateSteps);

    // Create symlinks
    if (workspaceConfig.agent.symlinks) {
      const symlinkSteps = createSymlinks(templateDir, workspacePath, workspaceConfig.agent.symlinks);
      result.steps.push(...symlinkSteps);
    }
  }

  // Generate .env file
  if (workspaceConfig.env?.template) {
    const envContent = replacePlaceholders(workspaceConfig.env.template, placeholders);
    writeFileSync(join(workspacePath, '.env'), envContent);
    result.steps.push('Created .env file');
  }

  // Process Docker compose templates
  if (workspaceConfig.docker?.compose_template) {
    const templateDir = join(projectConfig.path, workspaceConfig.docker.compose_template);
    const devcontainerDir = join(workspacePath, '.devcontainer');
    mkdirSync(devcontainerDir, { recursive: true });

    const templateSteps = processTemplates(templateDir, devcontainerDir, placeholders);
    result.steps.push(...templateSteps);

    // Copy non-template files (like Dockerfile)
    if (existsSync(templateDir)) {
      const files = readdirSync(templateDir);
      for (const file of files) {
        if (!file.endsWith('.template')) {
          const sourcePath = join(templateDir, file);
          const targetPath = join(devcontainerDir, file);
          copyFileSync(sourcePath, targetPath);
        }
      }
    }
  }

  // Initialize beads if available
  try {
    await execAsync('bd init', { cwd: workspacePath });
    result.steps.push('Initialized beads');
  } catch {
    // Beads not available, skip
  }

  // Start Docker containers if requested
  if (startDocker) {
    // Check for Traefik
    if (workspaceConfig.docker?.traefik) {
      const traefikPath = join(projectConfig.path, workspaceConfig.docker.traefik);
      if (existsSync(traefikPath)) {
        try {
          await execAsync(`docker compose -f "${traefikPath}" up -d`, { cwd: projectConfig.path });
          result.steps.push('Started Traefik');
        } catch (error) {
          result.errors.push(`Failed to start Traefik: ${error}`);
        }
      }
    }

    // Start workspace containers
    const composeLocations = [
      join(workspacePath, 'docker-compose.yml'),
      join(workspacePath, 'docker-compose.yaml'),
      join(workspacePath, '.devcontainer', 'docker-compose.yml'),
      join(workspacePath, '.devcontainer', 'docker-compose.devcontainer.yml'),
    ];

    for (const composePath of composeLocations) {
      if (existsSync(composePath)) {
        try {
          await execAsync('docker compose up -d --build', { cwd: dirname(composePath), timeout: 300000 });
          result.steps.push(`Started containers from ${basename(composePath)}`);
        } catch (error) {
          result.errors.push(`Failed to start containers: ${error}`);
        }
        break;
      }
    }
  }

  result.success = result.errors.length === 0;
  return result;
}

export interface WorkspaceRemoveOptions {
  projectConfig: ProjectConfig;
  featureName: string;
  dryRun?: boolean;
}

export interface WorkspaceRemoveResult {
  success: boolean;
  errors: string[];
  steps: string[];
}

/**
 * Remove a workspace
 */
export async function removeWorkspace(options: WorkspaceRemoveOptions): Promise<WorkspaceRemoveResult> {
  const { projectConfig, featureName, dryRun } = options;
  const result: WorkspaceRemoveResult = {
    success: true,
    errors: [],
    steps: [],
  };

  const workspaceConfig = projectConfig.workspace || getDefaultWorkspaceConfig();
  const workspacesDir = join(projectConfig.path, workspaceConfig.workspaces_dir || 'workspaces');
  const featureFolder = `feature-${featureName}`;
  const workspacePath = join(workspacesDir, featureFolder);

  if (!existsSync(workspacePath)) {
    result.success = false;
    result.errors.push(`Workspace not found at ${workspacePath}`);
    return result;
  }

  if (dryRun) {
    result.steps.push('[DRY RUN] Would remove workspace at: ' + workspacePath);
    return result;
  }

  // Stop Docker containers
  const composeLocations = [
    join(workspacePath, '.devcontainer', 'docker-compose.devcontainer.yml'),
    join(workspacePath, '.devcontainer', 'docker-compose.yml'),
    join(workspacePath, 'docker-compose.yml'),
  ];

  for (const composePath of composeLocations) {
    if (existsSync(composePath)) {
      try {
        // Stop containers and remove volumes
        await execAsync('docker compose down -v', { cwd: dirname(composePath) });
        result.steps.push('Stopped Docker containers');
      } catch {
        // Containers might not be running
      }
      break;
    }
  }

  // Clean up Docker-created files (root-owned in containers)
  try {
    await execAsync(
      `docker run --rm -v "${workspacePath}:/workspace" alpine sh -c "find /workspace -user root -delete 2>/dev/null || true"`,
      { timeout: 30000 }
    );
    result.steps.push('Cleaned up Docker-created files');
  } catch {
    // Alpine container might not be available
  }

  // Remove worktrees
  if (workspaceConfig.type === 'polyrepo' && workspaceConfig.repos) {
    for (const repo of workspaceConfig.repos) {
      const repoPath = join(projectConfig.path, repo.path);
      const targetPath = join(workspacePath, repo.name);
      const branchPrefix = repo.branch_prefix || 'feature/';
      const branchName = `${branchPrefix}${featureName}`;

      const worktreeResult = await removeWorktree(repoPath, targetPath, branchName);
      if (worktreeResult.success) {
        result.steps.push(`Removed worktree for ${repo.name}`);
      } else {
        result.errors.push(worktreeResult.message);
      }
    }
  } else {
    // Monorepo: remove single worktree
    const branchName = `feature/${featureName}`;
    const worktreeResult = await removeWorktree(projectConfig.path, workspacePath, branchName);
    if (worktreeResult.success) {
      result.steps.push('Removed worktree');
    } else {
      result.errors.push(worktreeResult.message);
    }
  }

  // Remove DNS entries
  if (workspaceConfig.dns) {
    const placeholders = createPlaceholders(projectConfig, featureName, workspacePath);

    for (const entryPattern of workspaceConfig.dns.entries) {
      const hostname = replacePlaceholders(entryPattern, placeholders);
      if (removeWsl2HostEntry(hostname)) {
        result.steps.push(`Removed DNS entry: ${hostname}`);
      }
    }
  }

  // Release ports
  if (workspaceConfig.ports) {
    for (const [portName] of Object.entries(workspaceConfig.ports)) {
      const portFile = join(projectConfig.path, `.${portName}-ports`);
      if (releasePort(portFile, featureFolder)) {
        result.steps.push(`Released ${portName} port`);
      }
    }
  }

  // Remove workspace directory
  try {
    await execAsync(`rm -rf "${workspacePath}"`);
    result.steps.push('Removed workspace directory');
  } catch (error) {
    result.errors.push(`Failed to remove workspace directory: ${error}`);
  }

  result.success = result.errors.length === 0;
  return result;
}
