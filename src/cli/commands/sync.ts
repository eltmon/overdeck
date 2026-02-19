import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync, symlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../../lib/config.js';
import { createBackup } from '../../lib/backup.js';
import { planSync, executeSync, planHooksSync, syncHooks, syncStatusline } from '../../lib/sync.js';
import { SYNC_TARGET, isDevMode } from '../../lib/paths.js';
import { listProjects } from '../../lib/projects.js';
import { cleanupLegacyRuntimeSymlinks, migrateSyncTargets } from '../../lib/config-migration.js';

// Get path to bundled git hooks
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BUNDLED_GIT_HOOKS_DIR = join(__dirname, '..', '..', 'scripts', 'git-hooks');

// Helper to check if a command exists
function checkCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

interface SyncOptions {
  dryRun?: boolean;
  force?: boolean;
  backupOnly?: boolean;
}

export async function syncCommand(options: SyncOptions): Promise<void> {
  // Dry run mode
  if (options.dryRun) {
    console.log(chalk.bold('Sync Plan (dry run):\n'));

    // Show dev mode status
    if (isDevMode()) {
      console.log(chalk.magenta('Developer mode detected - dev-skills will be synced\n'));
    }

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

    const plan = planSync();

    console.log(chalk.cyan('claude:'));

    if (plan.skills.length === 0 && plan.commands.length === 0 && plan.agents.length === 0 && plan.devSkills.length === 0) {
      console.log(chalk.dim('  (nothing to sync)'));
    } else {
      for (const item of plan.skills) {
        const icon = item.status === 'conflict' ? chalk.yellow('!') : chalk.green('+');
        const status = item.status === 'conflict' ? chalk.yellow('[conflict]') : '';
        console.log(`  ${icon} skill/${item.name} ${status}`);
      }

      // Show dev-skills with special label
      for (const item of plan.devSkills) {
        const icon = item.status === 'conflict' ? chalk.yellow('!') : chalk.magenta('+');
        const status = item.status === 'conflict' ? chalk.yellow('[conflict]') : chalk.magenta('[dev]');
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
    }

    console.log('');
    console.log(chalk.dim('Run without --dry-run to apply changes.'));
    return;
  }

  // Run one-time migration: strip legacy sync targets from config.toml
  const syncMigration = migrateSyncTargets();
  if (syncMigration.migrated) {
    if (syncMigration.hadNonClaudeTargets) {
      console.log(chalk.yellow('Config updated: removed non-Claude sync targets (Panopticon now syncs to Claude Code only).'));
    }
  }

  // Run one-time migration: remove Panopticon-managed symlinks from legacy runtime dirs
  const cleanupResult = cleanupLegacyRuntimeSymlinks();
  if (cleanupResult.cleaned.length > 0) {
    console.log(chalk.dim(`Removed ${cleanupResult.total} legacy runtime symlink(s): ${cleanupResult.cleaned.join(', ')}`));
  }

  const config = loadConfig();

  // Create backup if enabled
  if (config.sync.backup_before_sync) {
    const spinner = ora('Creating backup...').start();

    const backupDirs = [
      SYNC_TARGET.skills,
      SYNC_TARGET.commands,
      SYNC_TARGET.agents,
    ];

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
  const spinner = ora('Syncing to Claude Code...').start();

  const result = executeSync({ force: options.force });

  if (result.conflicts.length > 0 && !options.force) {
    spinner.warn(`Synced ${result.created.length} items, ${result.conflicts.length} conflicts`);
    console.log('');
    console.log(chalk.yellow('Conflicts:'));
    for (const name of result.conflicts) {
      console.log(chalk.dim(`  - ${name} (use --force to overwrite)`));
    }
    console.log('');
    console.log(chalk.dim('Use --force to overwrite conflicting items.'));
  } else {
    spinner.succeed(`Synced ${result.created.length} items to Claude Code`);
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

  // Check jq availability (required by statusline, beads, specialists)
  if (!checkCommand('jq')) {
    console.log(chalk.yellow('\n  ⚠ jq not found — statusline and other features need it'));
    console.log(chalk.dim('    Install: apt install jq / brew install jq\n'));
  }

  // Sync statusline to all runtimes
  const statuslineSpinner = ora('Syncing statusline...').start();
  const statuslineResult = syncStatusline();

  if (statuslineResult.errors.length > 0) {
    statuslineSpinner.warn(`Synced statusline to ${statuslineResult.synced.length} runtime(s), ${statuslineResult.errors.length} error(s)`);
    for (const error of statuslineResult.errors) {
      console.log(chalk.red(`  ✗ ${error}`));
    }
  } else if (statuslineResult.synced.length > 0) {
    statuslineSpinner.succeed(`Synced statusline to ${statuslineResult.synced.join(', ')}`);
  } else {
    statuslineSpinner.info('No statusline script found (scripts/statusline.sh)');
  }

  // Check and install claude-code-router if missing
  const hasRouter = checkCommand('claude-code-router');
  if (!hasRouter) {
    const routerSpinner = ora('Installing claude-code-router...').start();
    try {
      execSync('npm install -g @musistudio/claude-code-router', {
        stdio: 'pipe',
        timeout: 120000
      });
      routerSpinner.succeed('claude-code-router installed');
    } catch (error) {
      routerSpinner.warn('Failed to install claude-code-router - run: npm install -g @musistudio/claude-code-router');
    }
  }

  // Sync git hooks to all registered projects (branch protection)
  const projects = listProjects();
  if (projects.length > 0 && existsSync(BUNDLED_GIT_HOOKS_DIR)) {
    const gitHooksSpinner = ora('Installing git hooks in registered projects...').start();
    let totalInstalled = 0;
    let projectsUpdated = 0;

    for (const { config } of projects) {
      if (!existsSync(config.path)) continue;

      // Find all .git directories (handles polyrepos)
      const gitDirs: string[] = [];

      // Check root
      if (existsSync(join(config.path, '.git')) && statSync(join(config.path, '.git')).isDirectory()) {
        gitDirs.push(join(config.path, '.git'));
      } else {
        // Scan for polyrepo
        try {
          const entries = readdirSync(config.path);
          for (const entry of entries) {
            const entryPath = join(config.path, entry);
            const gitPath = join(entryPath, '.git');
            if (existsSync(gitPath) && statSync(gitPath).isDirectory()) {
              gitDirs.push(gitPath);
            }
          }
        } catch {
          // Skip unreadable directories
        }
      }

      // Install hooks in each git dir
      for (const gitDir of gitDirs) {
        const hooksTarget = join(gitDir, 'hooks');
        if (!existsSync(hooksTarget)) {
          mkdirSync(hooksTarget, { recursive: true });
        }

        try {
          const hooks = readdirSync(BUNDLED_GIT_HOOKS_DIR).filter(f =>
            statSync(join(BUNDLED_GIT_HOOKS_DIR, f)).isFile()
          );

          for (const hook of hooks) {
            const source = join(BUNDLED_GIT_HOOKS_DIR, hook);
            const target = join(hooksTarget, hook);

            // Skip if already a symlink to our hook
            if (existsSync(target)) {
              try {
                const { readlinkSync } = await import('fs');
                if (readlinkSync(target) === source) continue;
              } catch {
                // Not a symlink
              }
              // Backup existing
              const { renameSync } = await import('fs');
              try { renameSync(target, `${target}.backup`); } catch {}
            }

            try {
              symlinkSync(source, target);
              totalInstalled++;
            } catch {}
          }
          projectsUpdated++;
        } catch {}
      }
    }

    if (totalInstalled > 0) {
      gitHooksSpinner.succeed(`Installed git hooks in ${projectsUpdated} project(s)`);
    } else {
      gitHooksSpinner.info('Git hooks already up to date');
    }
  }
}
