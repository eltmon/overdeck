import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync, symlinkSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../../lib/config.js';
import { createBackup } from '../../lib/backup.js';
import { planSync, executeSync, refreshCache, migrateStalePersonalContent, planHooksSync, syncHooks, syncStatusline } from '../../lib/sync.js';
import { SYNC_TARGET, isDevMode } from '../../lib/paths.js';
import { getDevrootPath } from '../../lib/config.js';
import { listProjects } from '../../lib/projects.js';
import { cleanupLegacyRuntimeSymlinks, migrateSyncTargets } from '../../lib/config-migration.js';
import { migratePanopticonToPan } from '../../lib/workspace-manager.js';

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
  diff?: boolean;
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

    const devrootPath = getDevrootPath();
    console.log(chalk.cyan(`devroot (${devrootPath || 'disabled'}):`));

    if (!devrootPath) {
      console.log(chalk.dim('  (devroot disabled — set sync.devroot in config)'));
    } else {
      const plan = planSync();
      const allItems = [...plan.skills, ...plan.agents, ...plan.rules, ...plan.commands];

      if (allItems.length === 0) {
        console.log(chalk.dim('  (nothing to sync)'));
      } else {
        for (const item of allItems) {
          const icon = item.status === 'conflict' ? chalk.yellow('!') :
                       item.status === 'symlink' ? chalk.blue('↻') :
                       chalk.green('+');
          const label = item.status === 'conflict' ? chalk.yellow('[modified]') :
                        item.status === 'symlink' ? chalk.dim('[update]') :
                        chalk.green('[new]');
          console.log(`  ${icon} ${item.name} ${label}`);
        }
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

  // One-time migration: remove Panopticon symlinks from ~/.claude/ (devroot replaces this)
  const migration = migrateStalePersonalContent();
  if (migration.removedSymlinks.length > 0) {
    console.log(chalk.cyan(`Migrated: removed ${migration.removedSymlinks.length} Panopticon symlink(s) from ~/.claude/`));
    if (migration.preservedUserContent.length > 0) {
      console.log(chalk.dim(`  Preserved ${migration.preservedUserContent.length} user-created item(s)`));
    }
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

  // Refresh cache from repo source
  const cacheSpinner = ora('Refreshing cache from repo...').start();
  const cacheResult = refreshCache();
  const cacheParts = [];
  if (cacheResult.skills.copied > 0) cacheParts.push(`${cacheResult.skills.copied} skills`);
  if (cacheResult.agents.copied > 0) cacheParts.push(`${cacheResult.agents.copied} agents`);
  if (cacheResult.rules.copied > 0) cacheParts.push(`${cacheResult.rules.copied} rules`);
  cacheSpinner.succeed(`Cache refreshed: ${cacheParts.length > 0 ? cacheParts.join(', ') : 'up to date'}`);

  // Execute sync to devroot
  const devrootPath = getDevrootPath();
  const spinner = ora(`Syncing to devroot (${devrootPath || 'disabled'})...`).start();

  if (!devrootPath) {
    spinner.info('Devroot disabled (set sync.devroot in config to enable)');
  } else {
    const result = executeSync({ force: options.force, diff: options.diff });
    const totalSynced = result.created.length + result.updated.length;

    // Show diffs if requested
    if (result.diffs.length > 0) {
      spinner.info(`Showing diffs for ${result.diffs.length} modified file(s):\n`);
      for (const d of result.diffs) {
        console.log(chalk.cyan(`--- ${d.path} (installed)`));
        console.log(chalk.cyan(`+++ ${d.path} (current on disk)`));
        // Simple line-by-line diff
        const sourceLines = d.sourceContent.split('\n');
        const targetLines = d.targetContent.split('\n');
        const maxLines = Math.max(sourceLines.length, targetLines.length);
        for (let i = 0; i < maxLines; i++) {
          if (sourceLines[i] !== targetLines[i]) {
            if (targetLines[i] !== undefined) console.log(chalk.red(`- ${targetLines[i]}`));
            if (sourceLines[i] !== undefined) console.log(chalk.green(`+ ${sourceLines[i]}`));
          }
        }
        console.log('');
      }
    }

    if (result.conflicts.length > 0 && !options.force) {
      spinner.warn(`Synced ${totalSynced} items, ${result.conflicts.length} conflicts`);
      console.log('');
      console.log(chalk.yellow('Modified since Panopticon installed:'));
      for (const name of result.conflicts) {
        console.log(chalk.dim(`  - ${name}`));
      }
      console.log('');
      console.log(chalk.dim('Use --force to overwrite, --diff to see changes.'));
    } else if (result.skipped.length > 0) {
      spinner.succeed(`Synced ${totalSynced} items to devroot (${result.skipped.length} user-owned skipped)`);
    } else {
      spinner.succeed(`Synced ${totalSynced} items to devroot`);
    }
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

  // Check and install mkcert if missing
  if (!checkCommand('mkcert')) {
    const mkcertSpinner = ora('Installing mkcert...').start();
    try {
      const binDir = join(homedir(), '.local', 'bin');
      mkdirSync(binDir, { recursive: true });
      const mkcertPath = join(binDir, 'mkcert');
      const arch = process.arch === 'x64' ? 'amd64' : process.arch;
      execSync(`curl -sL "https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-${arch}" -o "${mkcertPath}" && chmod +x "${mkcertPath}"`, {
        stdio: 'pipe',
        timeout: 60000,
      });
      mkcertSpinner.succeed('mkcert installed');
    } catch {
      mkcertSpinner.warn('Failed to install mkcert - run: https://github.com/FiloSottile/mkcert/releases');
    }
  }

  // Check and install SageOx CLI if missing
  if (!checkCommand('ox')) {
    const oxSpinner = ora('Installing SageOx CLI (ox)...').start();
    try {
      const binDir = join(homedir(), '.local', 'bin');
      mkdirSync(binDir, { recursive: true });
      const oxPath = join(binDir, 'ox');
      const arch = process.arch === 'x64' ? 'amd64' : process.arch;
      const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
      execSync(`curl -sL "https://github.com/eltmon/ox/releases/download/latest/ox-${platform}-${arch}" -o "${oxPath}" && chmod +x "${oxPath}"`, {
        stdio: 'pipe',
        timeout: 60000,
      });
      oxSpinner.succeed('SageOx CLI installed');
    } catch {
      oxSpinner.warn('Failed to install SageOx CLI - see: https://github.com/eltmon/ox/releases');
    }
  }


  // Migrate .panopticon/ → .pan/ in all registered projects
  const projects = listProjects();
  for (const { config } of projects) {
    if (!existsSync(config.path)) continue;
    const migResult = migratePanopticonToPan(config.path);
    if (migResult.migrated.length > 0) {
      console.log(chalk.cyan(`Migrated .panopticon/ → .pan/ in ${config.name}: ${migResult.migrated.join(', ')}`));
    }
    if (migResult.skipped.length > 0) {
      console.log(chalk.yellow(`Migration skipped (both exist) in ${config.name}: ${migResult.skipped.join(', ')}`));
    }
    for (const err of migResult.errors) {
      console.log(chalk.red(`Migration error in ${config.name}: ${err}`));
    }
  }

  // Sync git hooks to all registered projects (branch protection)
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
