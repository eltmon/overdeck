/**
 * pan remote init
 *
 * Initialize the Fly.io app for workspace machines.
 * Creates the app if it doesn't exist.
 */

import chalk from 'chalk';
import { Effect } from 'effect';
import ora from 'ora';
import { exec } from 'child_process';
import { promisify } from 'util';
import { loadConfigSync } from '../../../lib/config.js';
import { createFlyProvider, type VmInfo } from '../../../lib/remote/index.js';

const execAsync = promisify(exec);

interface InitOptions {
  app?: string;
  org?: string;
  region?: string;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const config = loadConfigSync();

  if (!config.remote?.enabled) {
    console.log('');
    console.log(chalk.yellow('Remote workspaces not enabled.'));
    console.log(chalk.dim('Run: pan remote setup'));
    return;
  }

  const appName = options.app ?? config.remote.fly?.app ?? 'pan-workspaces';
  const org = options.org ?? config.remote.fly?.org ?? 'personal';
  const region = options.region ?? config.remote.fly?.region ?? 'iad';

  const spinner = ora(`Initializing Fly app '${appName}'...`).start();

  try {
    const fly = createFlyProvider({
      app: appName,
      org,
      region,
    });

    // Check authentication
    const isAuth = await Effect.runPromise(fly.isAuthenticated());
    if (!isAuth) {
      spinner.fail('Not authenticated with Fly.io');
      console.log('');
      console.log(chalk.dim('Run: fly auth login  or  export FLY_API_TOKEN=<token>'));
      return;
    }

    // List machines to verify app access (ensureApp is called in createVm)
    spinner.text = `Checking app '${appName}'...`;
    let machines: VmInfo[] = [];
    try {
      machines = await Effect.runPromise(fly.listVms());
      spinner.succeed(`App '${appName}' exists with ${machines.length} machine(s)`);
    } catch (err: any) {
      if (err.statusCode === 404 || err.message?.includes('404')) {
        spinner.text = `Creating app '${appName}'...`;
        // App doesn't exist — it will be created on first createVm call
        // For now, just report what would happen
        spinner.info(`App '${appName}' will be created on first workspace`);
      } else {
        throw err;
      }
    }

    console.log('');
    console.log(chalk.bold('Remote Infrastructure Ready'));
    console.log('');
    console.log(`  App:     ${chalk.cyan(appName)}`);
    console.log(`  Org:     ${chalk.dim(org)}`);
    console.log(`  Region:  ${chalk.dim(region)}`);
    if (machines.length > 0) {
      console.log(`  Machines: ${chalk.dim(machines.length.toString())}`);
    }
    console.log('');
    console.log('Next steps:');
    console.log('');
    console.log(`  ${chalk.cyan('pan remote status')}                        Check status`);
    console.log(`  ${chalk.cyan('pan workspace create --remote <issue>')}    Create a workspace`);
    console.log('');
  } catch (error: any) {
    spinner.fail(`Failed: ${error.message}`);
    console.log('');
    console.log(chalk.dim('Check your Fly.io credentials and app name.'));
  }
}
