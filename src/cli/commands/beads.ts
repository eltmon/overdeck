/**
 * Beads management commands
 *
 * Commands for managing the beads issue tracker integration.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface CompactOptions {
  days?: number;
  dryRun?: boolean;
  json?: boolean;
}

/**
 * Check if bd CLI is available
 */
async function isBdAvailable(): Promise<boolean> {
  try {
    await execAsync('which bd', { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get count of closed beads older than N days
 */
async function getOldClosedCount(cwd: string, days: number): Promise<number> {
  try {
    const seconds = days * 24 * 60 * 60;
    const { stdout } = await execAsync(
      `bd list --status closed --json 2>/dev/null | jq '[.[] | select(.closed_at != null) | select((now - (.closed_at | fromdateiso8601)) > ${seconds})] | length' 2>/dev/null || echo "0"`,
      { cwd, encoding: 'utf-8' }
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Compact beads - remove closed issues older than N days
 */
async function compactCommand(options: CompactOptions): Promise<void> {
  const days = options.days || 30;
  const cwd = process.cwd();

  // Check if bd is available
  if (!(await isBdAvailable())) {
    console.error(chalk.red('Error: bd (beads) CLI not found in PATH'));
    console.log(chalk.dim('Install beads: https://github.com/steveyegge/beads'));
    process.exit(1);
  }

  // Check if .beads exists
  const beadsDir = join(cwd, '.beads');
  if (!existsSync(beadsDir)) {
    console.error(chalk.red('Error: No .beads directory found in current directory'));
    console.log(chalk.dim('Run bd init to initialize beads'));
    process.exit(1);
  }

  const spinner = ora('Checking for old closed beads...').start();

  try {
    // Get count of old closed beads
    const count = await getOldClosedCount(cwd, days);

    if (count === 0) {
      spinner.succeed('No closed beads older than ' + days + ' days found');
      return;
    }

    spinner.text = `Found ${count} closed beads older than ${days} days`;

    if (options.dryRun) {
      spinner.info(`Dry run: Would compact ${count} beads (use without --dry-run to execute)`);

      // Show what would be removed
      console.log('');
      console.log(chalk.bold('Beads that would be compacted:'));
      try {
        const { stdout: beadsList } = await execAsync(
          `bd list --status closed --json 2>/dev/null | jq -r '.[] | select(.closed_at != null) | select((now - (.closed_at | fromdateiso8601)) > ${days * 24 * 60 * 60}) | "  - \\(.id): \\(.title)"' 2>/dev/null`,
          { cwd, encoding: 'utf-8' }
        );
        console.log(beadsList || '  (none)');
      } catch {
        console.log(chalk.dim('  (could not list beads)'));
      }
      return;
    }

    // Run compaction
    spinner.text = 'Running compaction...';
    await execAsync(`bd admin compact --days ${days}`, { cwd, encoding: 'utf-8' });

    spinner.succeed(`Compacted ${count} beads older than ${days} days`);

    // Check for uncommitted changes
    try {
      await execAsync(`git diff --quiet .beads/`, { cwd, encoding: 'utf-8' });
      // No changes
      console.log(chalk.dim('No changes to commit (beads already up to date)'));
    } catch {
      // There are changes
      console.log('');
      console.log(chalk.bold('Changes detected in .beads/'));
      console.log(chalk.dim('To commit the compacted beads:'));
      console.log('');
      console.log('  git add .beads/');
      console.log('  git commit -m "chore: compact beads (remove closed issues > ' + days + ' days)"');
      console.log('  git push');
      console.log('');
    }

    if (options.json) {
      console.log(JSON.stringify({ success: true, compacted: count, days }, null, 2));
    }
  } catch (error: any) {
    spinner.fail('Compaction failed');
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

/**
 * Show beads statistics
 */
async function statsCommand(): Promise<void> {
  const cwd = process.cwd();

  if (!(await isBdAvailable())) {
    console.error(chalk.red('Error: bd (beads) CLI not found'));
    process.exit(1);
  }

  const beadsDir = join(cwd, '.beads');
  if (!existsSync(beadsDir)) {
    console.error(chalk.red('Error: No .beads directory found'));
    process.exit(1);
  }

  const spinner = ora('Gathering beads statistics...').start();

  try {
    // Get total count (--limit 0 = no limit)
    const { stdout: totalRaw } = await execAsync(`bd list --limit 0 --json 2>/dev/null | jq 'length'`, {
      cwd,
      encoding: 'utf-8',
    });
    const total = parseInt(totalRaw.trim(), 10) || 0;

    // Get open count
    const { stdout: openRaw } = await execAsync(`bd list --status open --limit 0 --json 2>/dev/null | jq 'length'`, {
      cwd,
      encoding: 'utf-8',
    });
    const open = parseInt(openRaw.trim(), 10) || 0;

    // Get closed count
    const { stdout: closedRaw } = await execAsync(`bd list --status closed --limit 0 --json 2>/dev/null | jq 'length'`, {
      cwd,
      encoding: 'utf-8',
    });
    const closed = parseInt(closedRaw.trim(), 10) || 0;

    // Get old closed count (30+ days)
    const oldClosed = await getOldClosedCount(cwd, 30);

    spinner.stop();

    console.log('');
    console.log(chalk.bold('Beads Statistics'));
    console.log('');
    console.log(`  Total:        ${chalk.cyan(total)}`);
    console.log(`  Open:         ${chalk.green(open)}`);
    console.log(`  Closed:       ${chalk.dim(closed)}`);
    console.log(`  Old (>30d):   ${oldClosed > 0 ? chalk.yellow(oldClosed) : chalk.dim(oldClosed)}`);
    console.log('');

    if (oldClosed > 0) {
      console.log(chalk.dim(`Tip: Run 'pan beads compact' to remove old closed beads`));
      console.log('');
    }
  } catch (error: any) {
    spinner.fail('Failed to get statistics');
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

export function registerBeadsCommands(program: Command): void {
  const beads = program.command('beads').description('Beads issue tracker management');

  beads
    .command('compact')
    .description('Remove closed beads older than N days')
    .option('-d, --days <days>', 'Days threshold (default: 30)', '30')
    .option('--dry-run', 'Show what would be compacted without making changes')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      await compactCommand({
        days: parseInt(options.days, 10),
        dryRun: options.dryRun,
        json: options.json,
      });
    });

  beads
    .command('stats')
    .description('Show beads statistics')
    .action(async () => {
      await statsCommand();
    });
}
