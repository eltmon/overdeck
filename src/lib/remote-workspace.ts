/**
 * Remote Workspace Creation
 *
 * Shared module for creating remote workspaces.
 * Used by both workspace.ts (explicit creation) and work/issue.ts (auto-creation).
 */

import chalk from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Data, Effect } from 'effect';
import { loadConfig } from './config.js';
import { createFlyProviderFromConfig } from './remote/index.js';
import { saveWorkspaceMetadata } from './remote/workspace-metadata.js';
import type { RemoteWorkspaceMetadata } from './remote/interface.js';
import { extractTeamPrefix, findProjectByTeam, resolveProjectFromIssue, getIssuePrefix } from './projects.js';

const execAsync = promisify(exec);

export interface CreateRemoteWorkspaceOptions {
  dryRun?: boolean;
  spinner?: { text: string };
}

/**
 * Create a remote workspace on Fly.io
 */
export async function createRemoteWorkspace(
  issueId: string,
  options: CreateRemoteWorkspaceOptions = {}
): Promise<RemoteWorkspaceMetadata> {
  const config = loadConfig();
  const remoteConfig = config.remote;

  if (!remoteConfig?.enabled) {
    throw new Error('Remote workspaces not enabled. Run `pan remote setup`');
  }

  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const branchName = `feature/${normalizedId}`;
  const fly = createFlyProviderFromConfig(config.remote);

  // Determine project context
  const teamPrefix = extractTeamPrefix(issueId);
  const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;
  const projectRoot = projectConfig?.path || process.cwd();

  // Determine project identifier for VM name
  let projectId = teamPrefix?.toLowerCase();
  if (!projectId && projectConfig && getIssuePrefix(projectConfig)) {
    projectId = getIssuePrefix(projectConfig)!.toLowerCase();
  }
  if (!projectId) {
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
  const vmName = `${projectId}-${normalizedId}-ws`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  if (options.dryRun) {
    console.log(chalk.bold('Would create remote workspace:'));
    console.log(`  VM:        ${chalk.cyan(vmName)}`);
    console.log(`  Project:   ${chalk.dim(projectId)}`);
    console.log(`  Branch:    ${chalk.dim(branchName)}`);
    throw new Error('Dry run - not implemented in this module');
  }

  // Get git remote URL
  let repoUrl = '';
  try {
    const { stdout } = await execAsync('git remote get-url origin', {
      cwd: projectRoot,
      encoding: 'utf-8',
    });
    repoUrl = stdout.trim();
  } catch {
    throw new Error('Could not determine git remote URL. Make sure you are in a git repository with a remote origin.');
  }

  if (options.spinner) {
    options.spinner.text = 'Creating VM (this may take 1-2 minutes)...';
  }

  // Step 1: Create VM
  await fly.createVm(vmName);

  // Step 2: Add GitHub host key and clone repository on VM
  if (options.spinner) {
    options.spinner.text = 'Cloning repository on VM...';
  }
  await fly.ssh(vmName, 'mkdir -p ~/.ssh && ssh-keyscan -t ed25519,rsa github.com >> ~/.ssh/known_hosts 2>/dev/null');
  const cloneResult = await fly.ssh(vmName, `git clone ${repoUrl} ~/workspace`);
  if (cloneResult.exitCode !== 0) {
    await fly.deleteVm(vmName);
    throw new Error(`Failed to clone: ${cloneResult.stderr}`);
  }

  // Step 3: Create feature branch
  if (options.spinner) {
    options.spinner.text = 'Creating feature branch...';
  }
  const branchResult = await fly.ssh(vmName, `cd ~/workspace && git checkout -b ${branchName}`);
  if (branchResult.exitCode !== 0) {
    await fly.ssh(vmName, `cd ~/workspace && git checkout ${branchName} || git checkout -b ${branchName}`);
  }

  // Step 4: Configure environment for shared infra
  const dbName = `myn_${normalizedId.replace(/-/g, '_')}`;
  const envContent = `
# Panopticon Remote Workspace
WORKSPACE_ID=${normalizedId}
ISSUE_ID=${issueId.toUpperCase()}

DATABASE_NAME=${dbName}
`;

  await fly.ssh(vmName, `cat > ~/workspace/.env.remote << 'EOF'
${envContent}
EOF`);

  // Step 6: Install beads CLI globally on remote VM
  if (options.spinner) {
    options.spinner.text = 'Installing beads CLI...';
  }
  const bdInstalled = await fly.installBeads(vmName);
  if (bdInstalled) {
    await fly.initBeads(vmName, '~/workspace');
  }

  // Step 6.5: Copy essential skills to remote VM
  if (options.spinner) {
    options.spinner.text = 'Copying skills to remote VM...';
  }
  await fly.copySkillsToVm(vmName);

  // Step 7: Start containers if docker compose exists
  let containersStarted = false;
  let frontendUrl = '';
  let apiUrl = '';

  const composeCheck = await fly.ssh(vmName, 'ls ~/workspace/docker-compose.yml ~/workspace/.devcontainer/docker-compose.yml 2>/dev/null | head -1');

  if (composeCheck.stdout.trim()) {
    if (options.spinner) {
      options.spinner.text = 'Starting containers...';
    }
    const composeDir = composeCheck.stdout.includes('.devcontainer')
      ? '~/workspace/.devcontainer'
      : '~/workspace';

    const upResult = await fly.ssh(vmName, `cd ${composeDir} && docker compose up -d 2>&1`);
    containersStarted = upResult.exitCode === 0;

    if (containersStarted) {
      if (options.spinner) {
        options.spinner.text = 'Exposing ports...';
      }
      try {
        frontendUrl = await fly.exposePort(vmName, 4173);
        apiUrl = await fly.exposePort(vmName, 7000);
      } catch {
        // Port exposure failed - not critical
      }
    }
  }

  // Step 8: Save workspace metadata
  const metadata: RemoteWorkspaceMetadata = {
    id: normalizedId,
    issue: issueId.toUpperCase(),
    provider: 'fly',
    vmName,
    urls: {
      frontend: frontendUrl || undefined,
      api: apiUrl || undefined,
    },
    created: new Date(),
    location: 'remote',
  };

  saveWorkspaceMetadata(metadata);

  return metadata;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Tagged error for remote-workspace Effect variants. */
export class RemoteWorkspaceError extends Data.TaggedError('RemoteWorkspaceError')<{
  readonly issueId: string;
  readonly stage: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Effect variant of `createRemoteWorkspace`. */
export const createRemoteWorkspaceEffect = (
  issueId: string,
  options: CreateRemoteWorkspaceOptions = {},
): Effect.Effect<RemoteWorkspaceMetadata, RemoteWorkspaceError> =>
  Effect.tryPromise({
    try: () => createRemoteWorkspace(issueId, options),
    catch: (cause) =>
      new RemoteWorkspaceError({
        issueId,
        stage: 'createRemoteWorkspace',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

