import { Effect } from 'effect';
/**
 * pan remote setup
 *
 * Interactive setup for Fly.io integration:
 * 1. Check if flyctl is installed
 * 2. Check FLY_API_TOKEN env var or fly auth status
 * 3. Configure Panopticon remote settings
 */

import chalk from 'chalk';
import ora from 'ora';
import { exec } from 'child_process';
import { promisify } from 'util';
import { loadConfigSync, saveConfigSync } from '../../../lib/config.js';
import { createFlyProvider } from '../../../lib/remote/index.js';

const execAsync = promisify(exec);

export async function setupCommand(): Promise<void> {
  console.log('');
  console.log(chalk.bold('🚀 Remote Workspace Setup'));
  console.log(chalk.dim('   Configure Fly.io for remote workspaces'));
  console.log('');

  // Step 1: Check if flyctl is installed
  const spinner = ora('Checking flyctl installation...').start();

  let flyInstalled = false;
  try {
    await execAsync('fly version', { timeout: 10000 });
    flyInstalled = true;
    spinner.succeed('flyctl is installed');
  } catch {
    spinner.warn('flyctl not found');
    console.log('');
    console.log('  Install flyctl:');
    console.log('');
    console.log(chalk.cyan('    curl -L https://fly.io/install.sh | sh'));
    console.log('  or');
    console.log(chalk.cyan('    brew install flyctl'));
    console.log('');
  }

  // Step 2: Check authentication
  console.log('');
  console.log(chalk.bold('  Step 2: Fly.io Authentication'));
  console.log('');

  const fly = createFlyProvider();
  const isAuth = await Effect.runPromise(fly.isAuthenticated());

  if (isAuth) {
    console.log(`  ${chalk.green('✓')} Authenticated with Fly.io`);

    // Show current user
    if (flyInstalled) {
      try {
        const { stdout } = await execAsync('fly auth whoami', { timeout: 10000 });
        console.log(`  ${chalk.dim('  User: ' + stdout.trim())}`);
      } catch {}
    }
  } else {
    console.log(`  ${chalk.yellow('!')} Not authenticated with Fly.io`);
    console.log('');

    if (process.env.FLY_API_TOKEN) {
      console.log('  FLY_API_TOKEN is set but authentication check failed.');
      console.log('  Verify your token is valid at: https://fly.io/user/personal_access_tokens');
    } else {
      console.log('  To authenticate:');
      console.log('');
      console.log(chalk.cyan('    fly auth login'));
      console.log('');
      console.log('  Or set an API token:');
      console.log(chalk.cyan('    export FLY_API_TOKEN=<your-token>'));
      console.log('');
      return;
    }
  }

  // Step 3: Configure Panopticon
  console.log('');
  console.log(chalk.bold('  Step 3: Configure Panopticon'));
  console.log('');

  const config = loadConfigSync();

  if (!config.remote?.enabled) {
    config.remote = {
      enabled: true,
      provider: 'fly',
      default_location: 'remote',
      auto_hibernate_minutes: 5,
      fly: {
        app: 'pan-workspaces',
        org: 'personal',
        region: 'iad',
        vm_size: 'shared-cpu-2x',
        vm_memory: 1024,
        image: 'registry.fly.io/pan-workspace:latest',
        auto_stop: true,
        auto_stop_timeout: 300,
      },
    };

    saveConfigSync(config);
    console.log(`  ${chalk.green('✓')} Remote configuration added to config.toml`);
    console.log('');
    console.log(chalk.dim('  Edit ~/.panopticon/config.toml to customize:'));
    console.log(chalk.dim('    [remote.fly]'));
    console.log(chalk.dim('    app = "pan-workspaces"   # Your Fly app name'));
    console.log(chalk.dim('    org = "personal"          # Your Fly org slug'));
    console.log(chalk.dim('    region = "iad"            # Default region'));
  } else {
    console.log(`  ${chalk.green('✓')} Remote already configured (provider: ${config.remote.provider})`);
  }

  // Summary
  console.log('');
  console.log(chalk.bold('Setup Complete!'));
  console.log('');
  console.log('Next steps:');
  console.log('');
  console.log(`  ${chalk.cyan('pan remote status')}     Check connection and machines`);
  console.log(`  ${chalk.cyan('pan workspace create --remote <issue>')}   Create remote workspace`);
  console.log('');
  console.log(chalk.dim('  Make sure your Fly app exists and the pan-workspace image is built.'));
  console.log(chalk.dim('  See: docs/fly-provider.md'));
  console.log('');
}
