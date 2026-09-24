import chalk from 'chalk';
import { listBackups, cleanOldBackups } from '../../lib/backup.js';

export async function backupListCommand(options: { json?: boolean }): Promise<void> {
  const backups = listBackups();

  if (options.json) {
    console.log(JSON.stringify(backups, null, 2));
    return;
  }

  if (backups.length === 0) {
    console.log(chalk.dim('No backups found.'));
    console.log(chalk.dim('Backups are created automatically during sync.'));
    return;
  }

  console.log(chalk.bold('Backups:\n'));

  for (const backup of backups) {
    console.log(`  ${chalk.cyan(backup.timestamp)}`);
    console.log(`    ${chalk.dim('Contains:')} ${backup.targets.join(', ')}`);
  }

  console.log();
  console.log(chalk.dim(`Total: ${backups.length} backups`));
  console.log(chalk.dim('Use `pan restore <timestamp>` to restore a backup.'));
}

export async function backupCleanCommand(options: { keep?: string }): Promise<void> {
  const keepCount = parseInt(options.keep || '10', 10);
  const removed = cleanOldBackups(keepCount);

  if (removed === 0) {
    console.log(chalk.dim(`No backups removed (keeping ${keepCount}).`));
  } else {
    console.log(chalk.green(`Removed ${removed} old backup(s), keeping ${keepCount}.`));
  }
}
