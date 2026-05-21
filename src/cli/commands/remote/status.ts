/**
 * pan remote status
 *
 * Shows Fly.io connection status and list of machines.
 */

import chalk from 'chalk';
import { Effect } from 'effect';
import ora from 'ora';
import { loadConfig } from '../../../lib/config.js';
import { createFlyProviderFromConfig, isRemoteAvailable } from '../../../lib/remote/index.js';

interface StatusOptions {
  json?: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const spinner = ora('Checking remote status...').start();

  try {
    const config = loadConfig();
    const remoteConfig = config.remote;

    // Check if remote is enabled
    const enabled = remoteConfig?.enabled ?? false;
    const provider = remoteConfig?.provider ?? 'fly';

    // Check availability
    const availability = await isRemoteAvailable();

    if (!availability.available) {
      spinner.warn('Remote not available');

      if (options.json) {
        console.log(JSON.stringify({
          enabled,
          provider,
          authenticated: false,
          available: false,
          reason: availability.reason,
          vms: [],
        }, null, 2));
        return;
      }

      console.log('');
      console.log(chalk.bold('Remote Workspaces Status'));
      console.log('');
      console.log(`  Provider:       ${chalk.cyan(provider)}`);
      console.log(`  Enabled:        ${enabled ? chalk.green('Yes') : chalk.dim('No')}`);
      console.log(`  Authenticated:  ${chalk.red('No')}`);
      console.log('');
      console.log(chalk.yellow(`  ${availability.reason}`));
      console.log('');
      console.log(chalk.dim('  Run: pan remote setup'));
      return;
    }

    // Get VM list
    const fly = createFlyProviderFromConfig(remoteConfig);
    const vms = await Effect.runPromise(fly.listVms());

    spinner.succeed('Connected to Fly.io');

    if (options.json) {
      console.log(JSON.stringify({
        enabled,
        provider,
        authenticated: true,
        available: true,
        vms,
      }, null, 2));
      return;
    }

    console.log('');
    console.log(chalk.bold('Remote Workspaces Status'));
    console.log('');
    console.log(`  Provider:       ${chalk.cyan(provider)}`);
    console.log(`  Enabled:        ${enabled ? chalk.green('Yes') : chalk.dim('No')}`);
    console.log(`  Authenticated:  ${chalk.green('Yes')}`);
    console.log('');

    if (vms.length === 0) {
      console.log(chalk.dim('  No VMs found.'));
      console.log(chalk.dim('  Run: pan remote init'));
    } else {
      console.log(chalk.bold('  VMs:'));
      console.log('');

      for (const vm of vms) {
        const statusIcon = vm.status === 'running'
          ? chalk.green('●')
          : vm.status === 'stopped'
            ? chalk.yellow('○')
            : chalk.dim('◌');

        const isInfra = '';
        console.log(`    ${statusIcon} ${vm.name}${isInfra} - ${vm.status}`);
      }
    }

    console.log('');
  } catch (error: any) {
    spinner.fail(`Failed to get status: ${error.message}`);
    process.exit(1);
  }
}
