/**
 * Remote Workspace Creation
 *
 * Shared module for creating remote workspaces.
 * Used by `pan start --remote`, `pan workspace create --remote` and
 * `pan workspace migrate --to remote`.
 */

import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { loadConfigSync } from './config.js';
import { createFlyProviderFromConfig } from './remote/index.js';
import { writeRemoteFile } from './remote/remote-agents.js';
import { saveWorkspaceMetadata } from './remote/workspace-metadata.js';
import type { RemoteWorkspaceMetadata } from './remote/interface.js';
import type { FlyProvider } from './remote/fly-provider.js';
import { shellQuote } from './remote/remote-tmux.js';
import { extractTeamPrefix, findProjectByTeam, resolveProjectFromIssueSync, getIssuePrefix } from './projects.js';
import { pushFeatureBranch } from './overdeck/feature-branch-push.js';

const execAsync = promisify(exec);

const CLONE_POLL_INTERVAL_MS = 5_000;
const CLONE_DEADLINE_MS = 20 * 60_000;

/**
 * Clone the repo into /workspace detached, then poll for its exit code
 * (PAN-4685). A synchronous clone of a large repo outlasts the Machines exec
 * deadline (60 s) and fails creation with a 408. The log and exit files live
 * in /tmp because git clone needs an empty /workspace.
 */
async function cloneDetached(
  fly: FlyProvider,
  vmName: string,
  repoUrl: string,
): Promise<{ exitCode: number; output: string }> {
  const script = `git clone ${repoUrl} /workspace > /tmp/pan-clone.log 2>&1; echo $? > /tmp/pan-clone.exit`;
  const start = await Effect.runPromise(fly.ssh(
    vmName,
    `rm -f /tmp/pan-clone.exit && setsid nohup sh -c ${shellQuote(script)} > /dev/null 2>&1 < /dev/null &`,
  ));
  if (start.exitCode !== 0) return { exitCode: start.exitCode, output: start.stderr || start.stdout };

  const deadline = Date.now() + CLONE_DEADLINE_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, CLONE_POLL_INTERVAL_MS));
    let code = '';
    try {
      // No exit file yet (cat exits 1) or a failed exec both mean: poll again.
      const poll = await Effect.runPromise(fly.ssh(vmName, 'cat /tmp/pan-clone.exit 2>/dev/null'));
      if (poll.exitCode === 0) code = poll.stdout.trim();
    } catch {
      continue;
    }
    if (code === '') continue;
    if (code === '0') return { exitCode: 0, output: '' };
    const log = await Effect.runPromise(fly.ssh(vmName, 'tail -5 /tmp/pan-clone.log'));
    return { exitCode: Number(code) || 1, output: log.stdout };
  }
  return { exitCode: 1, output: `clone did not finish within ${CLONE_DEADLINE_MS / 60_000} min` };
}

/**
 * Delete a VM whose creation failed, then return the error to throw
 * (PAN-4777). Before metadata is saved nothing points at the VM, so a VM
 * left running here bills with no record of it. On the durable tier the
 * message also names the `<vmName>-workspace` volume, because a failed
 * delete never reached `deleteVm`'s volume step.
 */
async function rollBackVm(
  fly: FlyProvider,
  vmName: string,
  machineId: string,
  error: unknown,
): Promise<unknown> {
  try {
    await Effect.runPromise(fly.deleteVm(vmName));
    return error;
  } catch (deleteError) {
    const reason = error instanceof Error ? error.message : String(error);
    const deleteReason = deleteError instanceof Error ? deleteError.message : String(deleteError);
    const appName = fly.getAppName();
    const volumeStep = fly.getResiliencyTier() === 'durable'
      ? `. Then destroy its volume: fly volumes list -a ${appName}, find ${vmName}-workspace, ` +
        `and run fly volumes destroy <volume-id> -a ${appName} --yes`
      : '';
    return new Error(
      `${reason}. The VM ${vmName} (machine ${machineId}, app ${appName}) could not be deleted: ${deleteReason}. ` +
        `Destroy it by hand: fly machines destroy ${machineId} -a ${appName} --force${volumeStep}`,
      { cause: error },
    );
  }
}

export interface CreateRemoteWorkspaceOptions {
  dryRun?: boolean;
  spinner?: { text: string };
  tier?: 'ephemeral' | 'durable';
}

/** Create a remote (Fly) workspace for an issue and return its metadata. */
export async function createRemoteWorkspace(
  issueId: string,
  options: CreateRemoteWorkspaceOptions = {}
): Promise<RemoteWorkspaceMetadata> {
  const config = loadConfigSync();
  const remoteConfig = config.remote;

  if (!remoteConfig?.enabled) {
    throw new Error('Remote workspaces not enabled. Run `pan admin remote setup`');
  }

  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const branchName = `feature/${normalizedId}`;
  const tier = options.tier ?? config.remote?.resiliency_tier;
  const fly = createFlyProviderFromConfig(config.remote, tier);

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
  const localWorkspacePath = join(projectRoot, 'workspaces', `feature-${normalizedId}`);

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

  // PAN-4683: the VM checks out feature/<id> from origin; push the local branch first
  // so the planned spec (committed on it) reaches the machine.
  if (existsSync(join(localWorkspacePath, '.git'))) {
    if (options.spinner) options.spinner.text = `Pushing ${branchName}...`;
    const push = await pushFeatureBranch({ cwd: localWorkspacePath, branch: branchName });
    if (!push.pushed) {
      throw new Error(`Could not push ${branchName} before creating the remote workspace: ${push.reason}. Push it with: git -C ${localWorkspacePath} push origin HEAD:refs/heads/${branchName}`);
    }
  }

  if (options.spinner) {
    options.spinner.text = 'Creating VM (this may take 1-2 minutes)...';
  }

  // Step 1: Create VM
  const vmInfo = await Effect.runPromise(fly.createVm(vmName));

  // Any failure once the VM exists deletes it before the error is thrown
  // (PAN-4777) — until metadata is saved, nothing else points at the VM.
  try {
    // Step 2: Sync credentials BEFORE cloning — git push needs gh auth wired as
    // the https credential helper, and the agent needs Claude credentials.
    if (options.spinner) {
      options.spinner.text = 'Syncing credentials to VM...';
    }
    await fly.syncAllCredentials(vmName);

    // Step 3: Clone repository on VM into /workspace (the image WORKDIR — the
    // agent spawn path and prompt both assume /workspace, never ~/workspace).
    if (options.spinner) {
      options.spinner.text = 'Cloning repository on VM...';
    }
    // VMs hold no SSH key (PAN-4295): clone over https, authenticated by the
    // synced gh token's credential helper.
    const httpsRepoUrl = repoUrl.replace(/^git@([^:]+):/, 'https://$1/');
    const cloneResult = await cloneDetached(fly, vmName, httpsRepoUrl);
    if (cloneResult.exitCode !== 0) {
      throw new Error(`Failed to clone: ${cloneResult.output}`);
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
    // ~/.claude/settings.json honoring the user's Overdeck permission mode).
    if (options.spinner) {
      options.spinner.text = 'Configuring Claude Code on VM...';
    }
    await fly.configureClaudeCode(vmName);

    // Step 6: Sync the workspace continue artifact, which is gitignored and does
    // not arrive via the clone.
    if (existsSync(localWorkspacePath)) {
      if (options.spinner) {
        options.spinner.text = 'Syncing planning artifacts to VM...';
      }
      const artifacts: Array<[string, string]> = [
        [join(localWorkspacePath, '.pan', 'continue.json'), '/workspace/.pan/continue.json'],
      ];
      for (const [localPath, remotePath] of artifacts) {
        if (!existsSync(localPath)) continue;
        // Chunked + size-verified: a single base64 exec silently truncates past
        // the ~16KB payload cap, and these files are the agent's resume state.
        await writeRemoteFile(fly, vmName, remotePath, readFileSync(localPath, 'utf-8'));
      }
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

    saveWorkspaceMetadata(metadata);

    return metadata;
  } catch (error) {
    throw await rollBackVm(fly, vmName, vmInfo.machineId ?? 'unknown', error);
  }
}
