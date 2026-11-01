import { exitCli } from '../exit.js';
import chalk from 'chalk';
import type { Ora } from 'ora';
import ora from 'ora';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { loadConfigSync } from '../../lib/config.js';
import { createFlyProviderFromConfig } from '../../lib/remote/index.js';
import type { RemoteWorkspaceMetadata } from '../../lib/remote/interface.js';
import {
  loadWorkspaceMetadata,
  WORKSPACES_DIR,
} from '../../lib/remote/workspace-metadata.js';

interface DestroyOptions {
  force?: boolean;
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
    return exitCli(1);
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
  const metadata = loadWorkspaceMetadata(normalizedId);

  if (!metadata || metadata.location !== 'remote') {
    spinner.fail(`No remote workspace found for ${issueId}`);
    console.log(chalk.dim('Create one with: pan workspace create --remote ' + issueId));
    return exitCli(1);
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
    return exitCli(1);
  }
}

/**
 * SSH into remote workspace
 */
export async function sshCommand(issueId: string): Promise<void> {
  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadata = loadWorkspaceMetadata(normalizedId);

  if (!metadata || metadata.location !== 'remote') {
    console.error(chalk.red(`No remote workspace found for ${issueId}`));
    console.log(chalk.dim('Create one with: pan workspace create --remote ' + issueId));
    return exitCli(1);
  }

  const { spawn } = await import('child_process');

  // Spawn interactive SSH session via Fly CLI
  const appName = metadata.appName || 'pan-workspaces';
  const child = spawn('fly', ['ssh', 'console', '-a', appName], {
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    return exitCli(code || 0);
  });
}

/**
 * Start a stopped remote workspace
 */
export async function startCommand(issueId: string): Promise<void> {
  const spinner = ora('Starting workspace...').start();

  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadata = loadWorkspaceMetadata(normalizedId);

  if (!metadata || metadata.location !== 'remote') {
    spinner.fail(`No remote workspace found for ${issueId}`);
    return exitCli(1);
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
    return exitCli(1);
  }
}

/**
 * Stop (hibernate) a remote workspace
 */
export async function stopCommand(issueId: string): Promise<void> {
  const spinner = ora('Stopping workspace...').start();

  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadata = loadWorkspaceMetadata(normalizedId);

  if (!metadata || metadata.location !== 'remote') {
    spinner.fail(`No remote workspace found for ${issueId}`);
    return exitCli(1);
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
    return exitCli(1);
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
    return exitCli(1);
  }
}
