import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../../lib/config.js';
import { createBackup } from '../../lib/backup.js';
import { planSync, executeSync, planHooksSync, syncHooks } from '../../lib/sync.js';
import { SYNC_TARGETS, Runtime } from '../../lib/paths.js';

interface SyncOptions {
  dryRun?: boolean;
  force?: boolean;
  backupOnly?: boolean;
}

export async function syncCommand(options: SyncOptions): Promise<void> {
  const config = loadConfig();
  const targets = config.sync?.targets;

  // Defensive check: ensure targets is defined and is a valid array
  if (!targets || !Array.isArray(targets) || targets.length === 0) {
    console.log(chalk.yellow('No sync targets configured.'));
    console.log(chalk.dim('Edit ~/.panopticon/config.toml to add targets to the [sync] section.'));
    console.log(chalk.dim('Example: targets = ["claude-code", "cursor"]'));
    return;
  }

  // Type assertion is now safe since we've validated the array
  const validTargets = targets as Runtime[];

  // Dry run mode
  if (options.dryRun) {
    console.log(chalk.bold('Sync Plan (dry run):\n'));

    // Show hooks plan
    const hooksPlan = planHooksSync();
    if (hooksPlan.length > 0) {
      console.log(chalk.cyan('hooks (bin scripts):'));
      for (const hook of hooksPlan) {
        const icon = hook.status === 'new' ? chalk.green('+') : chalk.blue('↻');
        const status = hook.status === 'new' ? '' : chalk.dim('[update]');
        console.log(`  ${icon} ${hook.name} ${status}`);
      }
      console.log('');
    }

    for (const runtime of validTargets) {
      const plan = planSync(runtime);

      console.log(chalk.cyan(`${runtime}:`));

      if (plan.skills.length === 0 && plan.commands.length === 0 && plan.agents.length === 0) {
        console.log(chalk.dim('  (nothing to sync)'));
        continue;
      }

      for (const item of plan.skills) {
        const icon = item.status === 'conflict' ? chalk.yellow('!') : chalk.green('+');
        const status = item.status === 'conflict' ? chalk.yellow('[conflict]') : '';
        console.log(`  ${icon} skill/${item.name} ${status}`);
      }

      for (const item of plan.commands) {
        const icon = item.status === 'conflict' ? chalk.yellow('!') : chalk.green('+');
        const status = item.status === 'conflict' ? chalk.yellow('[conflict]') : '';
        console.log(`  ${icon} command/${item.name} ${status}`);
      }

      for (const item of plan.agents) {
        const icon = item.status === 'conflict' ? chalk.yellow('!') : chalk.green('+');
        const status = item.status === 'conflict' ? chalk.yellow('[conflict]') : '';
        console.log(`  ${icon} agent/${item.name} ${status}`);
      }

      console.log('');
    }

    console.log(chalk.dim('Run without --dry-run to apply changes.'));
    return;
  }

  // Create backup if enabled
  if (config.sync.backup_before_sync) {
    const spinner = ora('Creating backup...').start();

    const backupDirs = validTargets.flatMap((r) => [
      SYNC_TARGETS[r].skills,
      SYNC_TARGETS[r].commands,
      SYNC_TARGETS[r].agents,
    ]);

    const backup = createBackup(backupDirs);

    if (backup.targets.length > 0) {
      spinner.succeed(`Backup created: ${backup.timestamp}`);
    } else {
      spinner.info('No existing content to backup');
    }

    if (options.backupOnly) {
      return;
    }
  }

  // Execute sync
  const spinner = ora('Syncing...').start();

  let totalCreated = 0;
  let totalConflicts = 0;

  for (const runtime of validTargets) {
    spinner.text = `Syncing to ${runtime}...`;

    const result = executeSync(runtime, { force: options.force });

    totalCreated += result.created.length;
    totalConflicts += result.conflicts.length;

    if (result.conflicts.length > 0 && !options.force) {
      console.log('');
      console.log(chalk.yellow(`Conflicts in ${runtime}:`));
      for (const name of result.conflicts) {
        console.log(chalk.dim(`  - ${name} (use --force to overwrite)`));
      }
    }
  }

  if (totalConflicts > 0 && !options.force) {
    spinner.warn(`Synced ${totalCreated} items, ${totalConflicts} conflicts`);
    console.log('');
    console.log(chalk.dim('Use --force to overwrite conflicting items.'));
  } else {
    spinner.succeed(`Synced ${totalCreated} items to ${validTargets.join(', ')}`);
  }

  // Sync hooks (bin scripts)
  const hooksSpinner = ora('Syncing hooks...').start();
  const hooksResult = syncHooks();

  if (hooksResult.errors.length > 0) {
    hooksSpinner.warn(`Synced ${hooksResult.synced.length} hooks, ${hooksResult.errors.length} errors`);
    for (const error of hooksResult.errors) {
      console.log(chalk.red(`  ✗ ${error}`));
    }
  } else if (hooksResult.synced.length > 0) {
    hooksSpinner.succeed(`Synced ${hooksResult.synced.length} hooks to ~/.panopticon/bin/`);
  } else {
    hooksSpinner.info('No hooks to sync');
  }
}
