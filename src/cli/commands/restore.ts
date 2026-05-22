import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { listBackupsSync, restoreBackupSync } from '../../lib/backup.js';
import { SYNC_TARGET } from '../../lib/paths.js';

export async function restoreCommand(timestamp?: string): Promise<void> {
  const backups = listBackupsSync();

  if (backups.length === 0) {
    console.log(chalk.yellow('No backups found.'));
    return;
  }

  // If no timestamp provided, let user choose
  if (!timestamp) {
    console.log(chalk.bold('Available backups:\n'));

    for (const backup of backups.slice(0, 10)) {
      console.log(`  ${chalk.cyan(backup.timestamp)} - ${backup.targets.join(', ')}`);
    }

    if (backups.length > 10) {
      console.log(chalk.dim(`  ... and ${backups.length - 10} more`));
    }

    console.log('');

    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: 'Select backup to restore:',
        choices: backups.slice(0, 10).map((b) => ({
          name: `${b.timestamp} (${b.targets.join(', ')})`,
          value: b.timestamp,
        })),
      },
    ]);

    timestamp = selected;
  }

  // Confirm restore
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Restore backup ${timestamp}? This will overwrite current files.`,
      default: false,
    },
  ]);

  if (!confirm) {
    console.log(chalk.dim('Restore cancelled.'));
    return;
  }

  const spinner = ora('Restoring backup...').start();

  try {
    // Build target dirs map (Claude Code only)
    const targetDirs: Record<string, string> = {
      'claude-skills': SYNC_TARGET.skills,
      'claude-commands': SYNC_TARGET.commands,
      'skills': SYNC_TARGET.skills,
      'commands': SYNC_TARGET.commands,
    };

    restoreBackupSync(timestamp!, targetDirs);

    spinner.succeed(`Restored backup: ${timestamp}`);

  } catch (error: any) {
    spinner.fail('Failed to restore');
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}
