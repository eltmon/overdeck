import { Effect } from 'effect';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfigSync, saveConfigSync, PanopticonConfig } from '../../lib/config.js';
import { getShadowModeFromEnv } from '../../lib/env-loader.js';
import { listShadowedIssues, getPendingSyncCount } from '../../lib/shadow-state.js';

export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description('Manage Panopticon configuration');

  // Shadow mode subcommand
  config
    .command('shadow')
    .description('Manage shadow mode settings')
    .option('--enable', 'Enable global shadow mode')
    .option('--disable', 'Disable global shadow mode')
    .option('--status', 'Show current shadow mode configuration')
    .option('--tracker <type>', 'Configure specific tracker (linear/github/gitlab/rally)')
    .action(configShadowCommand);
}

interface ShadowOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
  tracker?: string;
}

async function configShadowCommand(options: ShadowOptions): Promise<void> {
  const config = loadConfigSync();

  // Show status if no action specified
  if (!options.enable && !options.disable && !options.tracker) {
    options.status = true;
  }

  // Handle per-tracker configuration
  if (options.tracker) {
    const trackerType = options.tracker as 'linear' | 'github' | 'gitlab' | 'rally';
    const validTrackers = ['linear', 'github', 'gitlab', 'rally'];

    if (!validTrackers.includes(trackerType)) {
      console.log(chalk.red(`Error: Invalid tracker type '${trackerType}'`));
      console.log(chalk.dim(`Valid trackers: ${validTrackers.join(', ')}`));
      process.exit(1);
    }

    if (options.enable) {
      config.shadow.trackers[trackerType] = true;
      saveConfigSync(config);
      console.log(chalk.green(`✓ Shadow mode enabled for ${trackerType}`));
    } else if (options.disable) {
      config.shadow.trackers[trackerType] = false;
      saveConfigSync(config);
      console.log(chalk.green(`✓ Shadow mode disabled for ${trackerType}`));
    } else {
      // Show tracker status
      const enabled = config.shadow.trackers[trackerType];
      console.log(`${trackerType}: ${enabled ? chalk.cyan('👻 shadow mode') : chalk.dim('normal')}`);
    }
    return;
  }

  // Handle global enable/disable
  if (options.enable) {
    config.shadow.enabled = true;
    saveConfigSync(config);
    console.log(chalk.green('✓ Global shadow mode enabled'));
    console.log(chalk.dim('All issues will be tracked in shadow mode by default'));
    console.log(chalk.dim('Use --no-shadow flag to override for specific commands'));
    return;
  }

  if (options.disable) {
    config.shadow.enabled = false;
    saveConfigSync(config);
    console.log(chalk.green('✓ Global shadow mode disabled'));
    console.log(chalk.dim('Use --shadow flag to enable for specific commands'));
    return;
  }

  // Show status
  if (options.status) {
    console.log(chalk.bold('\nShadow Mode Configuration\n'));

    // Global setting
    const globalStatus = config.shadow.enabled
      ? chalk.cyan('👻 enabled')
      : chalk.dim('disabled');
    console.log(`Global: ${globalStatus}`);

    // Environment variable
    const envValue = process.env.SHADOW_MODE;
    const envStatus = envValue !== undefined
      ? getShadowModeFromEnv() ? chalk.cyan('👻 enabled') : chalk.dim('disabled')
      : chalk.dim('not set');
    console.log(`Environment (SHADOW_MODE): ${envStatus}`);

    // Per-tracker settings
    console.log(chalk.bold('\nPer-tracker settings:'));
    for (const [tracker, enabled] of Object.entries(config.shadow.trackers)) {
      const status = enabled ? chalk.cyan('👻 shadow') : chalk.dim('normal');
      console.log(`  ${tracker}: ${status}`);
    }

    // Current shadowed issues
    const shadowedIssues = await Effect.runPromise(listShadowedIssues());
    const pendingSync = await Effect.runPromise(getPendingSyncCount());

    if (shadowedIssues.length > 0) {
      console.log(chalk.bold(`\nShadowed issues: ${shadowedIssues.length}`));
      if (pendingSync > 0) {
        console.log(chalk.yellow(`⚠ ${pendingSync} issue(s) pending sync`));
      }

      console.log(chalk.dim('\nRecent shadowed issues:'));
      for (const issue of shadowedIssues.slice(0, 5)) {
        const syncStatus = issue.shadowStatus !== issue.trackerStatus
          ? chalk.yellow('(out of sync)')
          : chalk.green('(synced)');
        console.log(`  ${chalk.cyan(issue.issueId)}: ${issue.shadowStatus} ${syncStatus}`);
      }

      if (shadowedIssues.length > 5) {
        console.log(chalk.dim(`  ... and ${shadowedIssues.length - 5} more`));
      }
    }

    console.log('');

    // Configuration files
    console.log(chalk.dim('\nConfiguration sources (highest to lowest priority):'));
    console.log(chalk.dim('  1. CLI flag --shadow / --no-shadow'));
    console.log(chalk.dim('  2. Per-project .pan.yaml'));
    console.log(chalk.dim('  3. Global ~/.panopticon/config.yaml'));
    console.log(chalk.dim('  4. Environment SHADOW_MODE'));
    console.log(chalk.dim('  5. Default: false'));
    console.log('');
  }
}
