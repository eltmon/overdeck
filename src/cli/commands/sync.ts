import { Effect } from 'effect';
import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, symlinkSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { loadConfigSync } from '../../lib/config.js';
import { isXBriefFilename, parseXBriefFilename } from '../../lib/xbrief/lifecycle.js';
import { resolveGitHubIssueSync } from '../../lib/tracker-utils.js';
import { createBackupSync } from '../../lib/backup.js';
import {
  planSyncSync,
  executeSyncSync,
  refreshCacheSync,
  planHooksSyncSync,
  syncHooksSync,
  syncStatuslineSync,
  syncContextLayersSync,
  isStartupSyncNeededSync,
  writeSyncManifestSync,
} from '../../lib/sync.js';
import { executeAgentSkillsSync, planAgentSkillsSync } from '../../lib/harness-skill-sync.js';
import { SYNC_TARGET, SYNC_SOURCES, getOverdeckClaudeHome, isDevMode, isDeploymentGenerationRoot, packageRoot } from '../../lib/paths.js';
import { checkDevrootDeprecation } from '../../lib/config.js';
import { listProjectsSync } from '../../lib/projects.js';
import { cleanupAgentDirectories } from '../../lib/agent-directory-cleanup.js';
import { migrateOverdeckToPanSync } from '../../lib/workspace-manager.js';
import { ensurePlaywrightIsolationSync, ensureExcalidrawMcpSync } from '../../lib/claude-mcp.js';
import { resolveProjectContextFile } from '../../lib/context-layers/layers.js';
import { provisionClaudeHooks } from '../../lib/claude-hooks-provision.js';
import { provisionClaudePlugins } from '../../lib/claude-plugins-provision.js';
import { ensureAutomaticStateMigration, formatAutomaticStateMigrationBlock } from '../../lib/state-auto-migrate.js';

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

  // PAN-3327: the global `pan` symlink resolves into a `pan reload` deployment
  // generation, which is a detached worktree frozen at the commit it was built
  // from. Every path resolved relative to the CLI bundle inherits that freeze,
  // so say plainly which tree sync is about to distribute.
  if (isDeploymentGenerationRoot(packageRoot)) {
    console.log(chalk.yellow(
      'This `pan` is running from a `pan reload` deployment generation, which is frozen at the '
      + 'commit it was built from:',
    ));
    console.log(chalk.dim(`  ${packageRoot}`));
    console.log(
      SYNC_SOURCES.root === join(packageRoot, 'sync-sources')
        ? chalk.yellow(
          '  No checkout was recorded to sync from, so sync will distribute that frozen copy of '
          + 'sync-sources/. Merged hook, rule, and skill fixes will NOT be deployed. Run '
          + '`pan reload` to rebuild the generation from origin/main first.',
        )
        : chalk.dim(`  Syncing from the checkout it was built from: ${SYNC_SOURCES.root}`),
    );
    console.log('');
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
      console.log(chalk.cyan(`hooks (bin scripts) from ${SYNC_SOURCES.hooks}:`));
      for (const hook of hooksPlan) {
        const icon = hook.status === 'new'
          ? chalk.green('+')
          : hook.status === 'updated' ? chalk.blue('↻') : chalk.dim('=');
        const label = hook.status === 'new'
          ? ''
          : hook.status === 'updated' ? chalk.dim('[update]') : chalk.dim('[unchanged]');
        console.log(`  ${icon} ${hook.name} ${label}`);
      }
      console.log('');
    }

    // Bundled skills + agents → Overdeck-private Claude home.
    console.log(chalk.cyan('~/.overdeck/harnesses/claude/ (skills + agents):'));
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

    console.log(chalk.cyan('~/.overdeck/harnesses/agent-skills/ (managed harness launches):'));
    const agentSkillPlan = planAgentSkillsSync();
    const agentCount = (s: string) => agentSkillPlan.filter((i) => i.status === s).length;
    console.log(
      `  ${chalk.green(`${agentCount('new')} new`)}, ` +
        `${chalk.blue(`${agentCount('symlink')} update`)}, ` +
        `${chalk.dim(`${agentCount('exists')} unchanged or user-owned`)}, ` +
        `${chalk.yellow(`${agentCount('conflict')} user-modified (skipped)`)}`,
    );
    console.log('');

    console.log(chalk.cyan('context layers → Overdeck launch artifacts:'));
    console.log(`  ${chalk.blue('↻')} global → ~/.overdeck/context/{claude,pi,codex}-global.md`);

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
  if (cacheResult.pruned.length > 0) cacheParts.push(`pruned ${cacheResult.pruned.length} stale`);
  if (cacheResult.keptModified.length > 0) cacheParts.push(`kept ${cacheResult.keptModified.length} user-modified stale`);
  cacheSpinner.succeed(`Cache refreshed: ${cacheParts.length > 0 ? cacheParts.join(', ') : 'up to date'}`);

  // Populate only Overdeck-owned harness homes. Managed launchers opt in;
  // native ~/.claude and ~/.agents trees are never touched.
  const spinner = ora('Refreshing Overdeck-private harness assets...').start();
  const result = time('execute-sync', () => executeSyncSync({ force: options.force, diff: options.diff }));
  const agentSkillsResult = time('execute-agent-skills-sync', () =>
    executeAgentSkillsSync({ force: options.force, diff: options.diff }),
  );
  const totalSynced = result.created.length + result.updated.length + result.adopted.length;
  const totalAgentSkillsSynced = agentSkillsResult.created.length + agentSkillsResult.updated.length;
  const adoptionSummary = result.adopted.length > 0
    ? `, ${result.adopted.length} adopted (legacy pre-manifest installs)`
    : '';
  const prunedCount = result.pruned.length + agentSkillsResult.pruned.length;
  const keptModifiedCount = result.keptModified.length + agentSkillsResult.keptModified.length;
  const staleSummary = [
    ...(prunedCount > 0 ? [`pruned ${prunedCount} stale`] : []),
    ...(keptModifiedCount > 0 ? [`kept ${keptModifiedCount} user-modified stale`] : []),
  ];
  const staleSummaryText = staleSummary.length > 0 ? `, ${staleSummary.join(', ')}` : '';

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

  if (result.conflicts.length + agentSkillsResult.conflicts.length > 0 && !options.force) {
    spinner.warn(`Synced ${totalSynced} private Claude items and ${totalAgentSkillsSynced} private skill files${adoptionSummary}${staleSummaryText}, ${result.conflicts.length + agentSkillsResult.conflicts.length} modified (skipped)`);
    console.log('');
    console.log(chalk.yellow('Modified since Overdeck installed:'));
    for (const name of [...result.conflicts, ...agentSkillsResult.conflicts.map((name) => `harnesses/agent-skills/${name}`)]) {
      console.log(chalk.dim(`  - ${name}`));
    }
    console.log('');
    console.log(chalk.dim('Use --force to overwrite, --diff to see changes.'));
  } else if (result.skipped.length + agentSkillsResult.skipped.length > 0) {
    spinner.succeed(`Synced ${totalSynced} private Claude items and ${totalAgentSkillsSynced} private skill files${adoptionSummary}${staleSummaryText} (${result.skipped.length + agentSkillsResult.skipped.length} unchanged)`);
  } else {
    spinner.succeed(`Synced ${totalSynced} private Claude items and ${totalAgentSkillsSynced} private skill files${adoptionSummary}${staleSummaryText}`);
  }

  const keptModifiedPaths = [
    ...result.keptModified,
    ...agentSkillsResult.keptModified.map((name) => `harnesses/agent-skills/${name}`),
  ];
  if (keptModifiedPaths.length > 0) {
    console.log('');
    console.log(chalk.yellow('Kept user-modified stale file(s):'));
    for (const name of keptModifiedPaths) console.log(chalk.dim(`  - ${name}`));
  }

  // Render layered context into Overdeck-owned launch artifacts.
  const ctxSpinner = ora('Rendering context layers...').start();
  const ctx = time('context-layers', () => syncContextLayersSync());
  const ctxParts: string[] = [];
  if (ctx.globalStubCreated) ctxParts.push('seeded global.md');
  if (ctx.claudeGlobalWritten) ctxParts.push('claude-global.md');
  if (ctx.piGlobalWritten) ctxParts.push('pi-global.md');
  if (ctx.codexGlobalWritten) ctxParts.push('codex-global.md');
  if (ctx.errors.length > 0) {
    ctxSpinner.warn(`Context layers rendered with ${ctx.errors.length} error(s)`);
    for (const e of ctx.errors) console.log(chalk.red(`  ✗ ${e}`));
  } else if (ctxParts.length > 0) {
    ctxSpinner.succeed(`Context layers rendered: ${ctxParts.join(', ')}`);
  } else {
    ctxSpinner.info('Context layers already up to date');
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
    // Name the tree the hooks came from and how many bytes actually moved. A
    // sync that changed nothing must read as such: PAN-3327 shipped a frozen
    // snapshot over itself for hours behind an unqualified success message.
    const changed = hooksResult.changed.length;
    const unchanged = hooksResult.unchanged.length;
    hooksSpinner.succeed(
      `Synced ${hooksResult.synced.length} hooks to ~/.overdeck/bin/ `
      + `(${changed} updated, ${unchanged} unchanged)`,
    );
    console.log(chalk.dim(`  from ${hooksResult.sourceRoot}`));
  } else {
    hooksSpinner.info('No hooks to sync');
  }

  // Register only in Overdeck's private Claude settings. Managed launchers
  // copy this private config into their per-agent CLAUDE_CONFIG_DIR.
  const hookRegistrationSpinner = ora('Registering private Claude Code hooks...').start();
  const hookProvision = await timeAsync('register-claude-hooks', () => provisionClaudeHooks());
  if (!hookProvision.ok) {
    hookRegistrationSpinner.warn(`Claude Code hooks unavailable: ${hookProvision.reason}`);
  } else if (hookProvision.changed) {
    hookRegistrationSpinner.succeed(`Registered ${hookProvision.registered.length} Claude Code hook(s)`);
  } else {
    hookRegistrationSpinner.info('Claude Code hooks already registered');
  }

  // Plugin CLI state is also provisioned only in Overdeck's canonical private
  // Claude home. Managed launch homes merge this layer with user-owned plugin
  // state without touching ~/.claude.
  const pluginSpinner = ora('Provisioning private Claude Code plugins...').start();
  const pluginProvision = await timeAsync('provision-claude-plugins', () =>
    provisionClaudePlugins({ configDir: getOverdeckClaudeHome() }));
  if (!pluginProvision.ok) {
    pluginSpinner.warn(`Claude Code plugins unavailable: ${pluginProvision.reason}`);
  } else if (pluginProvision.errors.length > 0) {
    pluginSpinner.warn(`Provisioned plugins with ${pluginProvision.errors.length} error(s)`);
    for (const error of pluginProvision.errors) console.log(chalk.red(`  ✗ ${error}`));
  } else if (pluginProvision.installed.length > 0) {
    pluginSpinner.succeed(`Installed ${pluginProvision.installed.length} private Claude Code plugin(s)`);
  } else {
    pluginSpinner.info('Private Claude Code plugins already provisioned');
  }

  const projects = listProjectsSync();
  for (const { key, config } of projects) {
    if (!existsSync(config.path)) continue;
    const migrationSpinner = ora(`Reconciling permanent state for ${config.name}...`).start();
    const migration = await ensureAutomaticStateMigration(key, config);
    if (migration.status === 'ready') {
      migrationSpinner.succeed(`Permanent state ready for ${config.name}`);
    } else {
      migrationSpinner.warn(formatAutomaticStateMigrationBlock(migration));
    }
  }

  // Check jq availability (required by statusline and specialists)
  if (!checkCommand('jq')) {
    console.log(chalk.yellow('\n  ⚠ jq not found — statusline and other features need it'));
    console.log(chalk.dim('    Install without sudo: curl -fsSL https://overdeck.ai/install | sh\n'));
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
  const mcpPath = join(getOverdeckClaudeHome(), 'mcp.json');
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

  // Migrate legacy Overdeck-owned workspace state in registered projects.
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

  // xBRIEF state disagreement audit (PAN-946: workspace-9ny)
  try {
    const auditSpinner = ora('Running xBRIEF state audit...').start();
    const disagreements: Array<{ issueId: string; problem: string; fix: string }> = [];
    const hasGh = checkCommand('gh');

    for (const { config } of projects) {
      if (!existsSync(config.path)) continue;

      const activeDir = join(config.path, 'vbrief', 'active');
      const completedDir = join(config.path, 'vbrief', 'completed');

      // (1) xBRIEF in active/ but tracker says closed
      if (existsSync(activeDir)) {
        const activeFiles = readdirSync(activeDir).filter(
          f => isXBriefFilename(f) && !f.startsWith('continue-')
        );
        for (const file of activeFiles) {
          const parsed = parseXBriefFilename(file);
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
                  problem: 'xBRIEF in active/ but GitHub issue is closed',
                  fix: `pan scope complete ${issueId}`,
                });
              }
            } catch { /* skip if gh fails */ }
          }
        }
      }

      // (2) xBRIEF in completed/ but workspace still exists
      if (existsSync(completedDir)) {
        const completedFiles = readdirSync(completedDir).filter(
          f => isXBriefFilename(f) && !f.startsWith('continue-')
        );
        for (const file of completedFiles) {
          const parsed = parseXBriefFilename(file);
          if (!parsed) continue;
          const issueId = parsed.issueId.toUpperCase();
          const workspacePath = join(config.path, 'workspaces', `feature-${issueId.toLowerCase()}`);
          if (existsSync(workspacePath)) {
            disagreements.push({
              issueId,
              problem: 'xBRIEF in completed/ but workspace worktree still exists',
              fix: `pan close ${issueId}`,
            });
          }
        }
      }

      // (3) tracker shows in-progress but no xBRIEF in active/ (scanning worktrees)
      const workspacesDir = join(config.path, 'workspaces');
      if (existsSync(workspacesDir)) {
        let activeIssueIds = new Set<string>();
        if (existsSync(activeDir)) {
          activeIssueIds = new Set(
            readdirSync(activeDir)
              .filter(f => isXBriefFilename(f) && !f.startsWith('continue-'))
              .map(f => {
                const parsed = parseXBriefFilename(f);
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

          // Flag if tracker is open OR if we couldn't check tracker (workspace without active xBRIEF is always suspicious)
          if (trackerOpen || !ghInfo.isGitHub || !hasGh) {
            disagreements.push({
              issueId: worktreeIssueId,
              problem: trackerOpen
                ? 'Tracker shows open but no xBRIEF in active/'
                : 'Workspace exists but no xBRIEF in active/',
              fix: `pan scope approve ${worktreeIssueId}`,
            });
          }
        }
      }
    }

    if (disagreements.length === 0) {
      auditSpinner.succeed('xBRIEF state audit passed — no disagreements');
    } else {
      auditSpinner.warn(`Found ${disagreements.length} xBRIEF state disagreement(s)`);
      for (const d of disagreements) {
        console.log(chalk.yellow(`  ⚠ ${d.issueId}: ${d.problem}`));
        console.log(chalk.dim(`    Fix: ${d.fix}`));
      }
    }
  } catch (auditErr: any) {
    console.warn(`[pan sync] xBRIEF audit failed (non-fatal): ${auditErr?.message ?? auditErr}`);
  }

  // Record the input hash so a future startup sync can skip when nothing changed.
  time('write-sync-manifest', () => writeSyncManifestSync());

  printTimings();
}
