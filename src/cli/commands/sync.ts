import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, symlinkSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../../lib/config.js';
import { parseVBriefFilename } from '../../lib/vbrief/lifecycle.js';
import { resolveGitHubIssue } from '../../lib/tracker-utils.js';
import { createBackup } from '../../lib/backup.js';
import { planSync, executeSync, refreshCache, migrateStalePersonalContent, removeLegacySkills070, planHooksSync, syncHooks, syncStatusline, mirrorProjectSkills } from '../../lib/sync.js';
import { SYNC_TARGET, isDevMode } from '../../lib/paths.js';
import { getDevrootPath } from '../../lib/config.js';
import { listProjects } from '../../lib/projects.js';
import { cleanupLegacyRuntimeSymlinks, migrateSyncTargets } from '../../lib/config-migration.js';
import { cleanupAgentDirectories } from '../../lib/agent-directory-cleanup.js';
import { migratePanopticonToPan } from '../../lib/workspace-manager.js';
import { runMultiToolSync, resolveAlsoSyncTools } from '../../lib/multi-tool-sync.js';
import { ensurePlaywrightIsolation } from '../../lib/claude-mcp.js';

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

    // Show .pan/skills/ source files for each registered project
    const dryRunProjects = listProjects();
    for (const { config } of dryRunProjects) {
      if (!existsSync(config.path)) continue;
      const panSkillsDir = join(config.path, '.pan', 'skills');
      if (existsSync(panSkillsDir)) {
        const skills = readdirSync(panSkillsDir, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name);
        if (skills.length > 0) {
          console.log(chalk.cyan(`\n.pan/skills/ (${config.name}):`));
          for (const skillName of skills) {
            console.log(`  ${chalk.green('+')} ${skillName} ${chalk.green('[project-local]')}`);
          }
        }
      }

      // Show multi-tool sync targets
      const tools = resolveAlsoSyncTools(config.path);
      if (tools.length > 0) {
        console.log(chalk.cyan(`\nmulti-tool sync (${config.name}): ${tools.join(', ')}`));
        const panSkillsDirExists = existsSync(join(config.path, '.pan', 'skills'));
        if (panSkillsDirExists) {
          const skills = readdirSync(join(config.path, '.pan', 'skills'), { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => e.name);
          for (const tool of tools) {
            for (const skillName of skills) {
              console.log(`  ${chalk.green('+')} ${skillName} → ${tool}`);
            }
          }
        }
      }
    }

    // Agent directory cleanup preview
    const agentCleanupPreview = await cleanupAgentDirectories({ dryRun: true });
    if (agentCleanupPreview.totalOrphaned > 0) {
      console.log(chalk.cyan(`\nagent cleanup (~/.panopticon/agents/):`));
      console.log(chalk.dim(`  Found ${agentCleanupPreview.totalOrphaned} orphaned directories`));
      for (const name of agentCleanupPreview.wouldRemove) {
        console.log(`  ${chalk.red('✗')} ${name}`);
      }
      for (const name of agentCleanupPreview.protected) {
        console.log(`  ${chalk.yellow('◆')} ${name} ${chalk.dim('(running session)')}`);
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

  // 0.7.0 upgrade: remove renamed/deleted legacy skills from ~/.claude/skills/
  const removedLegacy = removeLegacySkills070();
  if (removedLegacy.length > 0) {
    console.log(chalk.dim(`Removed ${removedLegacy.length} legacy skill(s) from upgrade to 0.7.0: ${removedLegacy.join(', ')}`));
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

  // Ensure beads database exists for each registered project (first-time setup guard).
  // bd install puts the binary in PATH, but bd init must be run once per project to
  // create the Dolt database. Without it, workspace beads creation silently fails.
  const projects = listProjects();
  if (projects.length > 0 && checkCommand('bd')) {
    for (const { key, config } of projects) {
      if (!existsSync(config.path)) continue;
      const mainBeadsDir = join(config.path, '.beads');
      if (!existsSync(mainBeadsDir)) continue; // Project hasn't used beads yet — skip
      // Test connectivity. If the database is missing, auto-init.
      try {
        execSync('bd list --json --limit 0 2>&1', { cwd: config.path, stdio: 'pipe', timeout: 8000 });
      } catch (e: any) {
        const msg = String(e?.stdout ?? e?.stderr ?? e?.message ?? '');
        if (msg.includes('database') && (msg.includes('not found') || msg.includes('not exist') || msg.includes('defaulting'))) {
          const beadsSpinner = ora(`Initializing beads database for ${config.name}...`).start();
          try {
            const prefix = (key || config.name).toLowerCase().replace(/[^a-z0-9-]/g, '-');
            execSync(`bd init --prefix ${prefix}`, { cwd: config.path, stdio: 'pipe', timeout: 20000 });
            try { execSync('git config beads.role contributor', { cwd: config.path, stdio: 'pipe' }); } catch { /* non-fatal */ }
            beadsSpinner.succeed(`Beads database initialized for ${config.name} (prefix: ${prefix})`);
          } catch {
            beadsSpinner.warn(`Could not auto-initialize beads for ${config.name} — run: cd ${config.path} && bd init`);
          }
        }
      }
    }
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

  // Check and install claudish if missing (for multi-model routing with OAuth support)
  const hasClaudish = checkCommand('claudish');
  if (!hasClaudish) {
    const claudishSpinner = ora('Installing claudish...').start();
    const plat = process.platform === 'darwin' ? 'darwin' : 'linux';
    if (plat === 'darwin') {
      claudishSpinner.warn('claudish not found - install via Homebrew: brew install eltmon/claudish/claudish');
    } else {
      // Linux: download binary from GitHub releases
      try {
        const binDir = join(homedir(), '.local', 'bin');
        const claudishPath = join(binDir, 'claudish');
        const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : 'x64';
        mkdirSync(binDir, { recursive: true });
        execSync(
          `curl -sL "https://github.com/eltmon/claudish/releases/latest/download/claudish-linux-${arch}" -o "${claudishPath}" && chmod +x "${claudishPath}"`,
          { stdio: 'pipe', timeout: 60000 }
        );
        claudishSpinner.succeed('claudish installed to ~/.local/bin/claudish');
      } catch {
        claudishSpinner.warn('claudish installation failed - download from github.com/eltmon/claudish/releases');
      }
    }
  } else {
    // Log claudish version for diagnostics
    try {
      const version = execSync('claudish --version 2>/dev/null || true', { encoding: 'utf8', stdio: 'pipe' }).trim();
      if (version) console.log(chalk.dim(`  claudish ${version.split('\n')[0]}`));
    } catch { /* non-fatal */ }
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

  // Enforce Playwright MCP --isolated flag to prevent stale zoom/profile state
  const mcpPath = join(homedir(), '.claude', 'mcp.json');
  try {
    if (existsSync(mcpPath)) {
      const mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      if (ensurePlaywrightIsolation(mcpConfig)) {
        writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
        console.log(chalk.green('✓ Added --isolated to Playwright MCP (prevents stale zoom/profile state)'));
      }
    }
  } catch {
    // Non-fatal — skip if mcp.json can't be read/written
  }

  // Migrate .panopticon/ → .pan/ and run multi-tool sync in all registered projects
  for (const { config } of projects) {
    if (!existsSync(config.path)) continue;

    // Migrate .panopticon/ subdirs → .pan/
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

    // Multi-tool skill sync (cursor, codex, windsurf, cline, copilot, aider)
    const toolSyncResults = runMultiToolSync(config.path);
    for (const r of toolSyncResults) {
      if (r.written.length > 0) {
        console.log(chalk.cyan(`Synced ${r.written.length} skill(s) to ${r.tool} in ${config.name}`));
      }
      for (const err of r.errors) {
        console.log(chalk.red(`Multi-tool sync error (${r.tool}) in ${config.name}: ${err}`));
      }
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

  // Ensure beads database exists for each registered project (first-time setup guard).
  // bd install puts the binary in PATH, but bd init must be run once per project to
  // create the Dolt database. Without it, workspace beads creation silently fails.
  if (projects.length > 0 && checkCommand('bd')) {
    for (const { key, config } of projects) {
      if (!existsSync(config.path)) continue;
      const mainBeadsDir = join(config.path, '.beads');
      if (!existsSync(mainBeadsDir)) continue; // Project hasn't used beads yet — skip
      // Test connectivity. If the database is missing, auto-init.
      try {
        execSync('bd list --json --limit 0 2>&1', { cwd: config.path, stdio: 'pipe', timeout: 8000 });
      } catch (e: any) {
        const msg = String(e?.stdout ?? e?.stderr ?? e?.message ?? '');
        if (msg.includes('database') && (msg.includes('not found') || msg.includes('not exist') || msg.includes('defaulting'))) {
          const beadsSpinner = ora(`Initializing beads database for ${config.name}...`).start();
          try {
            const prefix = (key || config.name).toLowerCase().replace(/[^a-z0-9-]/g, '-');
            execSync(`bd init --prefix ${prefix}`, { cwd: config.path, stdio: 'pipe', timeout: 20000 });
            beadsSpinner.succeed(`Beads database initialized for ${config.name} (prefix: ${prefix})`);
          } catch {
            beadsSpinner.warn(`Could not auto-initialize beads for ${config.name} — run: cd ${config.path} && bd init`);
          }
        }
      }
    }
  }

  // Mirror project-level skills/ → .claude/skills/ against the devroot when
  // configured, so pan sync works from any cwd (not just from inside the repo tree).
  const skillsMirror = mirrorProjectSkills(getDevrootPath() ?? process.cwd());
  const skillsParts: string[] = [];
  if (skillsMirror.added.length > 0) skillsParts.push(`${skillsMirror.added.length} added`);
  if (skillsMirror.updated.length > 0) skillsParts.push(`${skillsMirror.updated.length} updated`);
  if (skillsMirror.removed.length > 0) skillsParts.push(`${skillsMirror.removed.length} removed`);
  if (skillsParts.length > 0) {
    console.log(chalk.cyan(`Skills mirror: ${skillsParts.join(', ')}`));
  }

  // Agent directory cleanup
  const cleanupSpinner = ora('Checking for orphaned agent directories...').start();
  const agentCleanupResult = await cleanupAgentDirectories({ dryRun: false, force: options.force });

  if (agentCleanupResult.totalOrphaned === 0) {
    cleanupSpinner.succeed('No orphaned agent directories found');
  } else {
    const removedCount = agentCleanupResult.removed.length;
    const protectedCount = agentCleanupResult.protected.length;

    if (removedCount > 0) {
      cleanupSpinner.succeed(`Removed ${removedCount} orphaned director${removedCount === 1 ? 'y' : 'ies'}`);
    } else if (protectedCount > 0) {
      cleanupSpinner.info(`Found ${protectedCount} orphaned director${protectedCount === 1 ? 'y' : 'ies'} with running sessions (skipped)`);
    }

    if (agentCleanupResult.protected.length > 0) {
      console.log(chalk.dim(`  Protected (running sessions): ${agentCleanupResult.protected.join(', ')}`));
    }
  }

  // vBRIEF state disagreement audit (PAN-946: workspace-9ny)
  try {
    const auditSpinner = ora('Running vBRIEF state audit...').start();
    const disagreements: Array<{ issueId: string; problem: string; fix: string }> = [];
    const hasGh = checkCommand('gh');

    for (const { config } of projects) {
      if (!existsSync(config.path)) continue;

      const activeDir = join(config.path, 'vbrief', 'active');
      const completedDir = join(config.path, 'vbrief', 'completed');

      // (1) vBRIEF in active/ but tracker says closed
      if (existsSync(activeDir)) {
        const activeFiles = readdirSync(activeDir).filter(
          f => f.endsWith('.vbrief.json') && !f.startsWith('continue-')
        );
        for (const file of activeFiles) {
          const parsed = parseVBriefFilename(file);
          if (!parsed) continue;
          const issueId = parsed.issueId.toUpperCase();
          const ghInfo = resolveGitHubIssue(issueId);
          if (ghInfo.isGitHub && hasGh) {
            try {
              const state = execSync(
                `gh issue view ${ghInfo.number} --repo ${ghInfo.owner}/${ghInfo.repo} --json state --jq '.state'`,
                { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
              ).trim();
              if (state.toLowerCase() === 'closed') {
                disagreements.push({
                  issueId,
                  problem: 'vBRIEF in active/ but GitHub issue is closed',
                  fix: `pan scope complete ${issueId}`,
                });
              }
            } catch { /* skip if gh fails */ }
          }
        }
      }

      // (2) vBRIEF in completed/ but workspace still exists
      if (existsSync(completedDir)) {
        const completedFiles = readdirSync(completedDir).filter(
          f => f.endsWith('.vbrief.json') && !f.startsWith('continue-')
        );
        for (const file of completedFiles) {
          const parsed = parseVBriefFilename(file);
          if (!parsed) continue;
          const issueId = parsed.issueId.toUpperCase();
          const workspacePath = join(config.path, 'workspaces', `feature-${issueId.toLowerCase()}`);
          if (existsSync(workspacePath)) {
            disagreements.push({
              issueId,
              problem: 'vBRIEF in completed/ but workspace worktree still exists',
              fix: `pan close ${issueId}`,
            });
          }
        }
      }

      // (3) tracker shows in-progress but no vBRIEF in active/ (scanning worktrees)
      const workspacesDir = join(config.path, 'workspaces');
      if (existsSync(workspacesDir)) {
        let activeIssueIds = new Set<string>();
        if (existsSync(activeDir)) {
          activeIssueIds = new Set(
            readdirSync(activeDir)
              .filter(f => f.endsWith('.vbrief.json') && !f.startsWith('continue-'))
              .map(f => {
                const parsed = parseVBriefFilename(f);
                return parsed ? parsed.issueId.toUpperCase() : '';
              })
              .filter(Boolean)
          );
        }

        const worktreeEntries = readdirSync(workspacesDir, { withFileTypes: true })
          .filter(e => e.isDirectory() && e.name.startsWith('feature-'))
          .map(e => e.name.replace('feature-', '').toUpperCase());

        for (const worktreeIssueId of worktreeEntries) {
          if (activeIssueIds.has(worktreeIssueId)) continue;

          let trackerOpen = false;
          const ghInfo = resolveGitHubIssue(worktreeIssueId);
          if (ghInfo.isGitHub && hasGh) {
            try {
              const state = execSync(
                `gh issue view ${ghInfo.number} --repo ${ghInfo.owner}/${ghInfo.repo} --json state --jq '.state'`,
                { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }
              ).trim();
              trackerOpen = state.toLowerCase() === 'open';
            } catch { /* skip if gh fails — fall through to heuristic */ }
          }

          // Flag if tracker is open OR if we couldn't check tracker (workspace without active vBRIEF is always suspicious)
          if (trackerOpen || !ghInfo.isGitHub || !hasGh) {
            disagreements.push({
              issueId: worktreeIssueId,
              problem: trackerOpen
                ? 'Tracker shows open but no vBRIEF in active/'
                : 'Workspace exists but no vBRIEF in active/',
              fix: `pan scope approve ${worktreeIssueId}`,
            });
          }
        }
      }
    }

    if (disagreements.length === 0) {
      auditSpinner.succeed('vBRIEF state audit passed — no disagreements');
    } else {
      auditSpinner.warn(`Found ${disagreements.length} vBRIEF state disagreement(s)`);
      for (const d of disagreements) {
        console.log(chalk.yellow(`  ⚠ ${d.issueId}: ${d.problem}`));
        console.log(chalk.dim(`    Fix: ${d.fix}`));
      }
    }
  } catch (auditErr: any) {
    console.warn(`[pan sync] vBRIEF audit failed (non-fatal): ${auditErr?.message ?? auditErr}`);
  }
}
