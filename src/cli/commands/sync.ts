import { Effect } from 'effect';
import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, symlinkSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { loadConfigSync } from '../../lib/config.js';
import { parseVBriefFilename } from '../../lib/vbrief/lifecycle.js';
import { resolveGitHubIssueSync } from '../../lib/tracker-utils.js';
import { createBackupSync } from '../../lib/backup.js';
import {
  planSyncSync,
  executeSyncSync,
  refreshCacheSync,
  migrateStalePersonalContentSync,
  removeLegacySkills070Sync,
  planHooksSyncSync,
  syncHooksSync,
  syncStatuslineSync,
  mirrorProjectSkillsSync,
  syncPiSettingsSync,
  syncContextLayersSync,
  isStartupSyncNeededSync,
  writeSyncManifestSync,
} from '../../lib/sync.js';
import { SYNC_TARGET, SYNC_SOURCES, isDevMode } from '../../lib/paths.js';
import { checkDevrootDeprecation } from '../../lib/config.js';
import { listProjectsSync } from '../../lib/projects.js';
import { cleanupLegacyRuntimeSymlinksSync, migrateSyncTargetsSync } from '../../lib/config-migration.js';
import { cleanupAgentDirectories } from '../../lib/agent-directory-cleanup.js';
import { migrateOverdeckToPanSync } from '../../lib/workspace-manager.js';
import { runMultiToolSyncSync, resolveAlsoSyncToolsSync } from '../../lib/multi-tool-sync.js';
import { ensurePlaywrightIsolationSync, ensureExcalidrawMcpSync } from '../../lib/claude-mcp.js';

// Bundled git hooks distributed to registered projects (PAN-1201: sync-sources/).
const BUNDLED_GIT_HOOKS_DIR = SYNC_SOURCES.gitHooks;

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
  ifChanged?: boolean;
}

export async function syncCommand(options: SyncOptions): Promise<void> {
  const timings: Array<{ phase: string; ms: number }> = [];
  function time<T>(phase: string, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      timings.push({ phase, ms: Math.round(performance.now() - start) });
    }
  }
  async function timeAsync<T>(phase: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      timings.push({ phase, ms: Math.round(performance.now() - start) });
    }
  }
  function printTimings(): void {
    if (timings.length === 0) return;
    const summary = timings.map((t) => `${t.phase}=${t.ms}ms`).join(', ');
    console.log(chalk.dim(`[sync-timing] ${summary}`));
  }

  // PAN-1201: warn once if the deprecated sync.devroot is still configured.
  const devrootWarning = checkDevrootDeprecation();
  if (devrootWarning) {
    console.log(chalk.yellow(devrootWarning));
    console.log('');
  }

  // Startup-only shortcut: skip the expensive full sync when inputs are unchanged.
  if (options.ifChanged && !options.force) {
    const gate = isStartupSyncNeededSync();
    if (!gate.needed) {
      console.log(chalk.dim('[sync] skipped — inputs unchanged'));
      return;
    }
  }

  // Dry run mode
  if (options.dryRun) {
    console.log(chalk.bold('Sync Plan (dry run):\n'));

    // Show dev mode status
    if (isDevMode()) {
      console.log(chalk.magenta('Developer mode detected - dev-skills will be synced\n'));
    }

    // Show hooks plan
    const hooksPlan = planHooksSyncSync();
    if (hooksPlan.length > 0) {
      console.log(chalk.cyan('hooks (bin scripts):'));
      for (const hook of hooksPlan) {
        const icon = hook.status === 'new' ? chalk.green('+') : chalk.blue('↻');
        const status = hook.status === 'new' ? '' : chalk.dim('[update]');
        console.log(`  ${icon} ${hook.name} ${status}`);
      }
      console.log('');
    }

    // Bundled skills + agents → ~/.claude/
    console.log(chalk.cyan('~/.claude/ (skills + agents):'));
    const plan = planSyncSync();
    const allItems = [...plan.skills, ...plan.agents];
    if (allItems.length === 0) {
      console.log(chalk.dim('  (nothing to sync — check sync-sources/ and run `pan install`)'));
    } else {
      const count = (s: string) => allItems.filter((i) => i.status === s).length;
      console.log(
        `  ${chalk.green(`${count('new')} new`)}, ` +
          `${chalk.blue(`${count('symlink')} update`)}, ` +
          `${chalk.cyan(`${count('adopted')} adopted (legacy pre-manifest installs)`)}, ` +
          `${chalk.dim(`${count('exists')} unchanged`)}, ` +
          `${chalk.yellow(`${count('conflict')} user-modified (skipped)`)}`,
      );
    }
    console.log('');

    // Context layers → CLAUDE.md managed regions
    console.log(chalk.cyan('context layers → CLAUDE.md:'));
    console.log(`  ${chalk.blue('↻')} global → ~/.claude/CLAUDE.md ${chalk.dim('(managed region)')}`);
    for (const { config } of listProjectsSync()) {
      if (existsSync(join(config.path, '.pan', 'context', 'project.md'))) {
        console.log(
          `  ${chalk.blue('↻')} ${config.name} → ${join(config.path, 'CLAUDE.md')} ${chalk.dim('(managed region)')}`,
        );
      }
    }

    // Show .pan/skills/ source files for each registered project
    const dryRunProjects = listProjectsSync();
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
      const tools = resolveAlsoSyncToolsSync(config.path);
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
    const agentCleanupPreview = await Effect.runPromise(cleanupAgentDirectories({ dryRun: true }));
    if (agentCleanupPreview.totalOrphaned > 0) {
      console.log(chalk.cyan(`\nagent cleanup (~/.overdeck/agents/):`));
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
    printTimings();
    return;
  }

  // Run one-time migration: strip legacy sync targets from config.toml
  const syncMigration = time('migrate-sync-targets', () => migrateSyncTargetsSync());
  if (syncMigration.migrated) {
    if (syncMigration.hadNonClaudeTargets) {
      console.log(chalk.yellow('Config updated: removed non-Claude sync targets (Overdeck now syncs to Claude Code only).'));
    }
  }

  // Run one-time migration: remove Overdeck-managed symlinks from legacy runtime dirs
  const cleanupResult = time('cleanup-legacy-runtimes', () => cleanupLegacyRuntimeSymlinksSync());
  if (cleanupResult.cleaned.length > 0) {
    console.log(chalk.dim(`Removed ${cleanupResult.total} legacy runtime symlink(s): ${cleanupResult.cleaned.join(', ')}`));
  }

  // One-time migration: remove Overdeck symlinks from ~/.claude/ (devroot replaces this)
  const migration = time('migrate-stale-personal', () => migrateStalePersonalContentSync());
  if (migration.removedSymlinks.length > 0) {
    console.log(chalk.cyan(`Migrated: removed ${migration.removedSymlinks.length} Overdeck symlink(s) from ~/.claude/`));
    if (migration.preservedUserContent.length > 0) {
      console.log(chalk.dim(`  Preserved ${migration.preservedUserContent.length} user-created item(s)`));
    }
  }

  // 0.7.0 upgrade: remove renamed/deleted legacy skills from ~/.claude/skills/
  const removedLegacy = time('remove-legacy-skills', () => removeLegacySkills070Sync());
  if (removedLegacy.length > 0) {
    console.log(chalk.dim(`Removed ${removedLegacy.length} legacy skill(s) from upgrade to 0.7.0: ${removedLegacy.join(', ')}`));
  }

  const config = loadConfigSync();

  // Create backup if enabled
  if (config.sync.backup_before_sync) {
    const backupSpinner = ora('Creating backup...').start();

    const backupDirs = [
      SYNC_TARGET.skills,
      SYNC_TARGET.commands,
      SYNC_TARGET.agents,
    ];

    const backup = time('backup', () => createBackupSync(backupDirs));

    if (backup.targets.length > 0) {
      backupSpinner.succeed(`Backup created: ${backup.timestamp}`);
    } else {
      backupSpinner.info('No existing content to backup');
    }

    if (options.backupOnly) {
      printTimings();
      return;
    }
  }

  // Refresh cache from repo source
  const cacheSpinner = ora('Refreshing cache from repo...').start();
  const cacheResult = time('refresh-cache', () => refreshCacheSync());
  const cacheParts = [];
  if (cacheResult.skills.copied > 0) cacheParts.push(`${cacheResult.skills.copied} skills`);
  if (cacheResult.agents.copied > 0) cacheParts.push(`${cacheResult.agents.copied} agents`);
  if (cacheResult.rules.copied > 0) cacheParts.push(`${cacheResult.rules.copied} rules`);
  cacheSpinner.succeed(`Cache refreshed: ${cacheParts.length > 0 ? cacheParts.join(', ') : 'up to date'}`);

  // Distribute bundled skills + agents into the user's Claude Code home.
  const spinner = ora('Distributing skills and agents to ~/.claude/...').start();
  const result = time('execute-sync', () => executeSyncSync({ force: options.force, diff: options.diff }));
  const totalSynced = result.created.length + result.updated.length + result.adopted.length;
  const adoptionSummary = result.adopted.length > 0
    ? `, ${result.adopted.length} adopted (legacy pre-manifest installs)`
    : '';

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
    spinner.warn(`Synced ${totalSynced} items to ~/.claude/${adoptionSummary}, ${result.conflicts.length} user-modified (skipped)`);
    console.log('');
    console.log(chalk.yellow('Modified since Overdeck installed:'));
    for (const name of result.conflicts) {
      console.log(chalk.dim(`  - ${name}`));
    }
    console.log('');
    console.log(chalk.dim('Use --force to overwrite, --diff to see changes.'));
  } else if (result.skipped.length > 0) {
    spinner.succeed(`Synced ${totalSynced} items to ~/.claude/${adoptionSummary} (${result.skipped.length} unchanged or user-owned)`);
  } else {
    spinner.succeed(`Synced ${totalSynced} items to ~/.claude/${adoptionSummary}`);
  }

  // Render the layered context into harness CLAUDE.md files (PAN-1201).
  const ctxSpinner = ora('Rendering context layers...').start();
  const ctx = time('context-layers', () => syncContextLayersSync());
  const ctxParts: string[] = [];
  if (ctx.globalStubCreated) ctxParts.push('seeded global.md');
  if (ctx.globalWritten) ctxParts.push('~/.claude/CLAUDE.md');
  if (ctx.projectsWritten.length > 0) {
    ctxParts.push(`${ctx.projectsWritten.length} project file(s)`);
  }
  if (ctx.errors.length > 0) {
    ctxSpinner.warn(`Context layers rendered with ${ctx.errors.length} error(s)`);
    for (const e of ctx.errors) console.log(chalk.red(`  ✗ ${e}`));
  } else if (ctxParts.length > 0) {
    ctxSpinner.succeed(`Context layers rendered: ${ctxParts.join(', ')}`);
  } else {
    ctxSpinner.info('Context layers already up to date');
  }

  // One-time notice: a managed region was added to a file that already had
  // hand-authored content. Reassure the user their content is preserved and
  // point at the backup taken before the first injection.
  if (ctx.firstInjections.length > 0) {
    console.log(
      chalk.cyan('\n  ℹ Overdeck added a managed region to existing context file(s):'),
    );
    for (const fi of ctx.firstInjections) {
      console.log(`    • ${fi.file}`);
      console.log(
        chalk.dim(
          `      Your content outside the markers is untouched. Backup: ${fi.backupPath}`,
        ),
      );
    }
    console.log(
      chalk.dim(
        '    Edit the layer source (pan context edit), never the region between the markers.',
      ),
    );
  }

  // Sync hooks (bin scripts)
  const hooksSpinner = ora('Syncing hooks...').start();
  const hooksResult = time('sync-hooks', () => syncHooksSync());

  if (hooksResult.errors.length > 0) {
    hooksSpinner.warn(`Synced ${hooksResult.synced.length} hooks, ${hooksResult.errors.length} errors`);
    for (const error of hooksResult.errors) {
      console.log(chalk.red(`  ✗ ${error}`));
    }
  } else if (hooksResult.synced.length > 0) {
    hooksSpinner.succeed(`Synced ${hooksResult.synced.length} hooks to ~/.overdeck/bin/`);
  } else {
    hooksSpinner.info('No hooks to sync');
  }

  // Ensure beads database exists for each registered project (first-time setup guard).
  // bd install puts the binary in PATH, but bd init must be run once per project to
  // create the Dolt database. Without it, workspace beads creation silently fails.
  const projects = listProjectsSync();
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
  const statuslineResult = time('sync-statusline', () => syncStatuslineSync());

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

  // Enforce Overdeck-managed MCP server defaults: Playwright --isolated
  // flag (prevents stale zoom/profile state) and the off-the-shelf Excalidraw
  // MCP server (backs the /excalidraw skill). Both helpers are idempotent and
  // mutate the parsed config in place; we only write back if anything changed.
  const mcpPath = join(homedir(), '.claude', 'mcp.json');
  try {
    if (existsSync(mcpPath)) {
      const mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      const playwrightChanged = ensurePlaywrightIsolationSync(mcpConfig);
      const excalidrawChanged = ensureExcalidrawMcpSync(mcpConfig);
      if (playwrightChanged || excalidrawChanged) {
        writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
      }
      if (playwrightChanged) {
        console.log(chalk.green('✓ Added --isolated to Playwright MCP (prevents stale zoom/profile state)'));
      }
      if (excalidrawChanged) {
        console.log(chalk.green('✓ Registered Excalidraw MCP server (backs the /excalidraw skill)'));
      }
    }
  } catch {
    // Non-fatal — skip if mcp.json can't be read/written
  }

  // Migrate .overdeck/ → .pan/ and run multi-tool sync in all registered projects
  for (const { config } of projects) {
    if (!existsSync(config.path)) continue;

    // Migrate .overdeck/ subdirs → .pan/
    const migResult = migrateOverdeckToPanSync(config.path);
    if (migResult.migrated.length > 0) {
      console.log(chalk.cyan(`Migrated .overdeck/ → .pan/ in ${config.name}: ${migResult.migrated.join(', ')}`));
    }
    if (migResult.skipped.length > 0) {
      console.log(chalk.yellow(`Migration skipped (both exist) in ${config.name}: ${migResult.skipped.join(', ')}`));
    }
    for (const err of migResult.errors) {
      console.log(chalk.red(`Migration error in ${config.name}: ${err}`));
    }

    // Multi-tool skill sync (cursor, codex, windsurf, cline, copilot, aider)
    const toolSyncResults = runMultiToolSyncSync(config.path);
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

  // Pi harness — point Pi's settings file at ~/.claude/skills so it sees the
  // same skills tree we just synced. No-op when Pi is not on PATH (PAN-636).
  const piResult = syncPiSettingsSync();
  if (piResult.status === 'created') {
    console.log(chalk.cyan(`Pi settings: created ${piResult.path.replace(homedir(), '~')}`));
  } else if (piResult.status === 'updated') {
    console.log(chalk.cyan(`Pi settings: merged skills entry into ${piResult.path.replace(homedir(), '~')}`));
  } else if (piResult.status === 'skipped' && piResult.reason === 'existing settings.json is not valid JSON') {
    console.log(chalk.yellow(`Pi settings: ${piResult.path.replace(homedir(), '~')} is not valid JSON — left untouched`));
  }

  // Mirror project-level skills/ → .claude/skills/ for a project that keeps a
  // top-level skills/ tree, so pan sync works from inside such a project.
  const skillsMirror = mirrorProjectSkillsSync(process.cwd());
  const skillsParts: string[] = [];
  if (skillsMirror.added.length > 0) skillsParts.push(`${skillsMirror.added.length} added`);
  if (skillsMirror.updated.length > 0) skillsParts.push(`${skillsMirror.updated.length} updated`);
  if (skillsMirror.removed.length > 0) skillsParts.push(`${skillsMirror.removed.length} removed`);
  if (skillsParts.length > 0) {
    console.log(chalk.cyan(`Skills mirror: ${skillsParts.join(', ')}`));
  }

  // Agent directory cleanup
  const cleanupSpinner = ora('Checking for orphaned agent directories...').start();
  const agentCleanupResult = await Effect.runPromise(cleanupAgentDirectories({ dryRun: false, force: options.force }));

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
          const ghInfo = resolveGitHubIssueSync(issueId);
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
          const ghInfo = resolveGitHubIssueSync(worktreeIssueId);
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

  // Record the input hash so a future startup sync can skip when nothing changed.
  time('write-sync-manifest', () => writeSyncManifestSync());

  printTimings();
}
