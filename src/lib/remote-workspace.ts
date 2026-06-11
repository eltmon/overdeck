/**
 * Remote Workspace Creation
 *
 * Shared module for creating remote workspaces.
 * Used by both workspace.ts (explicit creation) and work/issue.ts (auto-creation).
 */

import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Data, Effect } from 'effect';
import { loadConfigSync } from './config.js';
import { createFlyProviderFromConfig } from './remote/index.js';
import { writeRemoteFile } from './remote/remote-agents.js';
import { saveWorkspaceMetadataSync } from './remote/workspace-metadata.js';
import type { RemoteWorkspaceMetadata } from './remote/interface.js';
import { extractTeamPrefix, findProjectByTeamSync, resolveProjectFromIssueSync, getIssuePrefix } from './projects.js';

const execAsync = promisify(exec);

export interface CreateRemoteWorkspaceOptions {
  dryRun?: boolean;
  spinner?: { text: string };
}async function createRemoteWorkspacePromise(
  issueId: string,
  options: CreateRemoteWorkspaceOptions = {}
): Promise<RemoteWorkspaceMetadata> {
  const config = loadConfigSync();
  const remoteConfig = config.remote;

  if (!remoteConfig?.enabled) {
    throw new Error('Remote workspaces not enabled. Run `pan remote setup`');
  }

  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const branchName = `feature/${normalizedId}`;
  const fly = createFlyProviderFromConfig(config.remote);

  // Determine project context
  const teamPrefix = extractTeamPrefix(issueId);
  const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
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
  const vmInfo = await Effect.runPromise(fly.createVm(vmName));

  // Step 2: Sync credentials BEFORE cloning — git push needs gh auth wired as
  // the https credential helper, and the agent needs Claude credentials.
  if (options.spinner) {
    options.spinner.text = 'Syncing credentials to VM...';
  }
  await fly.syncAllCredentials(vmName);

  // Step 3: Clone repository on VM into /workspace (the image WORKDIR — the
  // agent spawn path and prompt both assume /workspace, never ~/workspace).
  // Use the https URL: VMs have no GitHub SSH key, only the synced gh token.
  if (options.spinner) {
    options.spinner.text = 'Cloning repository on VM...';
  }
  const httpsRepoUrl = repoUrl.replace(/^git@github\.com:/, 'https://github.com/');
  const cloneResult = await Effect.runPromise(fly.ssh(vmName, `git clone ${httpsRepoUrl} /workspace`));
  if (cloneResult.exitCode !== 0) {
    await Effect.runPromise(fly.deleteVm(vmName));
    throw new Error(`Failed to clone: ${cloneResult.stderr}`);
  }
  await Effect.runPromise(
    fly.ssh(vmName, `cd /workspace && git config user.email "panopticon-agent[bot]@users.noreply.github.com" && git config user.name "panopticon-agent[bot]"`)
  );

  // Step 4: Check out the feature branch — track the existing origin branch if
  // one exists (e.g. the issue already has local work pushed), else create it.
  if (options.spinner) {
    options.spinner.text = 'Creating feature branch...';
  }
  await Effect.runPromise(
    fly.ssh(
      vmName,
      `cd /workspace && (git fetch origin ${branchName} && git checkout ${branchName}) || git checkout -b ${branchName}`
    )
  );

  // Step 5: Configure Claude Code on the VM (onboarding-complete marker +
  // ~/.claude/settings.json honoring the user's Panopticon permission mode).
  if (options.spinner) {
    options.spinner.text = 'Configuring Claude Code on VM...';
  }
  await fly.configureClaudeCode(vmName);

  // Step 6: Install beads CLI globally on remote VM
  if (options.spinner) {
    options.spinner.text = 'Installing beads CLI...';
  }
  const bdInstalled = await fly.installBeads(vmName);
  if (!bdInstalled) {
    console.warn('  ⚠ beads CLI (bd) install failed on VM — agent will have no bead tracking');
  }

  // Step 6.5: Sync planning artifacts from the local workspace, if one exists.
  // `.pan/continue.json` is gitignored and `.beads/issues.jsonl` is created by
  // planning in the local worktree — neither arrives via the clone.
  const localWorkspacePath = join(projectRoot, 'workspaces', `feature-${normalizedId}`);
  if (existsSync(localWorkspacePath)) {
    if (options.spinner) {
      options.spinner.text = 'Syncing planning artifacts to VM...';
    }
    const artifacts: Array<[string, string]> = [
      [join(localWorkspacePath, '.pan', 'continue.json'), '/workspace/.pan/continue.json'],
      [join(localWorkspacePath, '.beads', 'issues.jsonl'), '/workspace/.beads/issues.jsonl'],
    ];
    for (const [localPath, remotePath] of artifacts) {
      if (!existsSync(localPath)) continue;
      // Chunked + size-verified: a single base64 exec silently truncates past
      // the ~16KB payload cap, and these files are the agent's resume state.
      await writeRemoteFile(fly, vmName, remotePath, readFileSync(localPath, 'utf-8'));
    }
  }

  // Step 6.6: Initialize the beads DB and import the synced JSONL. Must run
  // AFTER the artifact sync — `bd init` does not auto-import a pre-existing
  // issues.jsonl, so init-then-sync leaves the dolt DB empty and the agent
  // sees zero beads.
  if (bdInstalled) {
    await fly.initBeads(vmName, '/workspace');
    const importResult = await Effect.runPromise(
      fly.ssh(vmName, 'cd /workspace && [ -f .beads/issues.jsonl ] && bd import -i .beads/issues.jsonl 2>&1 || true')
    );
    if (importResult.exitCode !== 0) {
      console.warn(`  ⚠ bd import failed on VM: ${importResult.stderr || importResult.stdout}`);
    }
  }

  // Step 6.7: Copy essential skills to remote VM
  if (options.spinner) {
    options.spinner.text = 'Copying skills to remote VM...';
  }
  await fly.copySkillsToVm(vmName);

  // Step 7: Start containers if docker compose exists
  let containersStarted = false;
  let frontendUrl = '';
  let apiUrl = '';

  const composeCheck = await Effect.runPromise(fly.ssh(vmName, 'ls /workspace/docker-compose.yml /workspace/.devcontainer/docker-compose.yml 2>/dev/null | head -1'));

  if (composeCheck.stdout.trim()) {
    if (options.spinner) {
      options.spinner.text = 'Starting containers...';
    }
    const composeDir = composeCheck.stdout.includes('.devcontainer')
      ? '/workspace/.devcontainer'
      : '/workspace';

    const upResult = await Effect.runPromise(fly.ssh(vmName, `cd ${composeDir} && docker compose up -d 2>&1`));
    containersStarted = upResult.exitCode === 0;

    if (containersStarted) {
      if (options.spinner) {
        options.spinner.text = 'Exposing ports...';
      }
      try {
        frontendUrl = await Effect.runPromise(fly.exposePort(vmName, 4173));
        apiUrl = await Effect.runPromise(fly.exposePort(vmName, 7000));
      } catch {
        // Port exposure failed - not critical
      }
    }
  }

  // Step 8: Save workspace metadata. machineId/appName let resolveVm() find
  // the machine directly instead of scanning every machine in the app.
  const metadata: RemoteWorkspaceMetadata = {
    id: normalizedId,
    issue: issueId.toUpperCase(),
    provider: 'fly',
    vmName,
    machineId: vmInfo.machineId,
    appName: fly.getAppName(),
    urls: {
      frontend: frontendUrl || undefined,
      api: apiUrl || undefined,
    },
    created: new Date(),
    location: 'remote',
  };

  saveWorkspaceMetadataSync(metadata);

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
export const createRemoteWorkspace = (
  issueId: string,
  options: CreateRemoteWorkspaceOptions = {},
): Effect.Effect<RemoteWorkspaceMetadata, RemoteWorkspaceError> =>
  Effect.tryPromise({
    try: () => createRemoteWorkspacePromise(issueId, options),
    catch: (cause) =>
      new RemoteWorkspaceError({
        issueId,
        stage: 'createRemoteWorkspace',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

