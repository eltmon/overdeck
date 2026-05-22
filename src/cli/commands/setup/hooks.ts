import { Effect } from 'effect';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { readSettingsOrAbortSync, backupSettingsSync, pruneBackupsSync, atomicWriteJsonSync, diffJson } from './safe-settings.js';
import { SYNC_SOURCES } from '../../../lib/paths.js';

export interface HookConfig {
  matcher: string;  // Regex pattern, e.g. ".*" for all tools or "Bash" for specific
  hooks: Array<{
    type: string;
    command: string;
  }>;
}

interface McpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ClaudeSettings {
  hooks?: {
    PreToolUse?: HookConfig[];
    PostToolUse?: HookConfig[];
    Stop?: HookConfig[];
    SessionStart?: HookConfig[];
    Notification?: HookConfig[];
    PreCompact?: HookConfig[];
    PostCompact?: HookConfig[];
    UserPromptSubmit?: HookConfig[];
    PermissionRequest?: HookConfig[];
  };
  mcpServers?: Record<string, McpServer>;
  [key: string]: any;
}

/**
 * Check if jq is installed
 */
function checkJqInstalled(): boolean {
  try {
    execSync('which jq', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to install jq using package manager
 */
function installJq(): boolean {
  console.log(chalk.yellow('Installing jq dependency...'));

  try {
    // Detect platform and package manager
    const platform = process.platform;

    if (platform === 'darwin') {
      // macOS - try homebrew
      try {
        execSync('brew --version', { stdio: 'pipe' });
        execSync('brew install jq', { stdio: 'inherit' });
        console.log(chalk.green('✓ jq installed via Homebrew'));
        return true;
      } catch {
        console.log(chalk.yellow('⚠ Homebrew not found'));
      }
    } else if (platform === 'linux') {
      // Linux - try apt, then yum
      try {
        execSync('apt-get --version', { stdio: 'pipe' });
        execSync('sudo apt-get update && sudo apt-get install -y jq', { stdio: 'inherit' });
        console.log(chalk.green('✓ jq installed via apt'));
        return true;
      } catch {
        try {
          execSync('yum --version', { stdio: 'pipe' });
          execSync('sudo yum install -y jq', { stdio: 'inherit' });
          console.log(chalk.green('✓ jq installed via yum'));
          return true;
        } catch {
          console.log(chalk.yellow('⚠ No supported package manager found (apt/yum)'));
        }
      }
    }

    return false;
  } catch (error) {
    console.log(chalk.red('✗ Failed to install jq automatically'));
    return false;
  }
}

/**
 * Per-hook-type detection of whether a Panopticon hook is already registered.
 * PAN-800: rewritten from an all-or-nothing short-circuit to a delta-install
 * check so users with older installs still get SessionStart/Notification/etc.
 * added without having to wipe their settings.
 */
function isHookConfigured(
  settings: ClaudeSettings,
  hookType: keyof NonNullable<ClaudeSettings['hooks']>,
  binDir: string,
  scriptName: string,
): boolean {
  const hooks = settings?.hooks?.[hookType] || [];
  return hooks.some((hookConfig: HookConfig) =>
    hookConfig.hooks?.some((hook: { type: string; command: string }) =>
      (hook.command?.includes(join(binDir, scriptName)) ?? false) ||
      (hook.command?.includes(`panopticon/bin/${scriptName}`) ?? false)
    )
  );
}

export function addPanopticonHookIfMissing(
  settings: ClaudeSettings,
  hookType: keyof NonNullable<ClaudeSettings['hooks']>,
  binDir: string,
  scriptName: string,
  matcher: string = '.*',
): boolean {
  if (!settings.hooks) {
    settings.hooks = {};
  }
  if (isHookConfigured(settings, hookType, binDir, scriptName)) return false;
  const list = (settings.hooks[hookType] ??= []);
  list.push({
    matcher,
    hooks: [{ type: 'command', command: join(binDir, scriptName) }],
  });
  return true;
}

/**
 * PAN-982: Remove a Panopticon hook entry by hookType + script name.
 *
 * Filters out the inner hook commands matching the given scriptName from each
 * matcher group, then drops any matcher group whose hook list became empty,
 * then drops the top-level hookType key if no matcher groups remain.
 *
 * Returns true if anything was removed (used to drive the "migrated" log line
 * in setupHooksCommand). Idempotent — safe to call when the hook is already
 * absent.
 */
function removeHookIfPresent(
  settings: ClaudeSettings,
  hookType: keyof NonNullable<ClaudeSettings['hooks']>,
  binDir: string,
  scriptName: string,
): boolean {
  const groups = settings?.hooks?.[hookType];
  if (!groups || groups.length === 0) return false;

  const fullPath = join(binDir, scriptName);
  const legacyMatch = `panopticon/bin/${scriptName}`;

  let removed = false;
  const newGroups: HookConfig[] = [];
  for (const group of groups) {
    const filteredInner = (group.hooks || []).filter((hook) => {
      const isMatch =
        (hook.command?.includes(fullPath) ?? false) ||
        (hook.command?.includes(legacyMatch) ?? false);
      if (isMatch) removed = true;
      return !isMatch;
    });
    if (filteredInner.length > 0) {
      newGroups.push({ ...group, hooks: filteredInner });
    } else {
      removed = true;
    }
  }

  if (newGroups.length > 0) {
    settings.hooks![hookType] = newGroups;
  } else {
    delete settings.hooks![hookType];
  }

  return removed;
}

export interface SetupHooksOptions {
  /**
   * Preview the proposed settings.json diff and exit without writing.
   * Hook scripts and directories are still installed; only the
   * settings.json mutation is skipped. (PAN-1137)
   */
  dryRun?: boolean;
}

/**
 * Setup Claude Code hooks for Panopticon heartbeat
 */
export async function setupHooksCommand(opts: SetupHooksOptions = {}): Promise<void> {
  const dryRun = opts.dryRun === true;
  console.log(chalk.bold('Setting up Panopticon heartbeat hooks\n'));
  if (dryRun) {
    console.log(chalk.cyan('— dry run: no settings.json write will be performed —\n'));
  }

  // 1. Check for jq dependency
  if (!checkJqInstalled()) {
    console.log(chalk.yellow('⚠ jq is required for heartbeat hooks'));
    const installed = installJq();

    if (!installed) {
      console.log(chalk.red('\n✗ Setup failed: jq dependency missing'));
      console.log(chalk.dim('\nPlease install jq manually:'));
      console.log(chalk.dim('  macOS:  brew install jq'));
      console.log(chalk.dim('  Ubuntu: sudo apt-get install jq'));
      console.log(chalk.dim('  CentOS: sudo yum install jq\n'));
      process.exit(1);
    }
  } else {
    console.log(chalk.green('✓ jq is installed'));
  }

  // 2. Ensure ~/.panopticon/bin directory exists
  const panopticonHome = join(homedir(), '.panopticon');
  const binDir = join(panopticonHome, 'bin');
  const heartbeatsDir = join(panopticonHome, 'heartbeats');

  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
    console.log(chalk.green('✓ Created ~/.panopticon/bin/'));
  }

  if (!existsSync(heartbeatsDir)) {
    mkdirSync(heartbeatsDir, { recursive: true });
    console.log(chalk.green('✓ Created ~/.panopticon/heartbeats/'));
  }

  // 3. Copy hook scripts to ~/.panopticon/bin/
  const hookScripts = [
    'pan-hook-lib.sh',        // PAN-800: shared library sourced by all hooks
    'pre-tool-hook',
    'heartbeat-hook',
    'stop-hook',
    'notification-hook',      // PAN-800: Notification — emits agent.waiting_started
    'specialist-stop-hook',
    'work-agent-stop-hook',   // PAN-800: chained from stop-hook; emits agent.resolution_changed
    'session-start-hook',          // PAN-800: SessionStart — emits agent.activity_changed(idle) + agent.model_set
    'user-prompt-submit-hook',     // UserPromptSubmit — clears waiting state, records message_received, restarts spinner
    'pre-compact-hook',            // PreCompact — emits activity=working/compact so dashboard shows compacting indicator
    'post-compact-hook',           // PostCompact — emits activity=idle to clear compacting state
    'record-cost-event.js',
    'tldr-read-enforcer',
    'tldr-post-edit',
    'permission-event-hook',   // PermissionRequest — emits conversation.permission_changed(waiting)
  ];
  for (const scriptName of hookScripts) {
    // Hook scripts ship under sync-sources/hooks/ (PAN-1201). SYNC_SOURCES.hooks
    // resolves correctly from both a checkout and an installed package.
    const sourcePath = join(SYNC_SOURCES.hooks, scriptName);
    const scriptDest = join(binDir, scriptName);

    if (!existsSync(sourcePath)) {
      console.log(chalk.red(`✗ Could not find ${scriptName} script`));
      console.log(chalk.dim(`  Checked: ${sourcePath}`));
      process.exit(1);
    }

    copyFileSync(sourcePath, scriptDest);
    chmodSync(scriptDest, 0o755); // Make executable
  }

  console.log(chalk.green('✓ Installed hook scripts (pre-tool, post-tool, stop, specialist-stop)'));

  // 4. Read or create Claude Code settings.json
  const claudeDir = join(homedir(), '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  // PAN-1137: refuse to proceed on parse failure. Previous behavior reset
  // settings to `{}` on JSON.parse error and wrote it back, erasing every
  // user customization (statusLine, theme, mcpServers, etc.).
  const settingsBefore: ClaudeSettings = readSettingsOrAbortSync(settingsPath);
  // Deep clone the pre-mutation snapshot for the dry-run diff. Cheap —
  // settings.json is small.
  const beforeSnapshot: ClaudeSettings = JSON.parse(JSON.stringify(settingsBefore));
  let settings: ClaudeSettings = settingsBefore;

  if (existsSync(settingsPath)) {
    console.log(chalk.green('✓ Read existing Claude Code settings'));
  } else {
    console.log(chalk.dim('No existing settings.json found, creating new file'));
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }
  }

  // 5. Check Python3 availability for TLDR
  let python3Available = false;
  try {
    execSync('python3 --version', { stdio: 'pipe' });
    python3Available = true;
    console.log(chalk.green('✓ Python3 is available for TLDR'));
  } catch {
    console.log(chalk.yellow('⚠ Python3 not found - TLDR integration will be unavailable'));
    console.log(chalk.dim('  Install Python3 to enable token-efficient code analysis\n'));
  }

  // 6. Configure TLDR MCP server in mcp.json (NOT settings.json)
  if (python3Available) {
    const mcpPath = join(dirname(settingsPath), 'mcp.json');
    let mcpConfig: Record<string, any> = {};
    try {
      if (existsSync(mcpPath)) {
        mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      }
    } catch {
      mcpConfig = {};
    }

    if (!mcpConfig.mcpServers) {
      mcpConfig.mcpServers = {};
    }

    if (mcpConfig.mcpServers.tldr) {
      console.log(chalk.cyan('✓ TLDR MCP server already configured'));
    } else {
      mcpConfig.mcpServers.tldr = {
        command: '.venv/bin/tldr-mcp',
        args: ['--project', '.']
      };
      writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2));
      console.log(chalk.green('✓ Configured TLDR MCP server in mcp.json'));
    }
  }

  // 7. Delta-register missing hooks. Existing registrations are left alone so
  // users can hand-customize matchers without the installer clobbering them.
  if (!settings.hooks) {
    settings.hooks = {};
  }

  const added: string[] = [];
  const addHookIfMissing = (
    hookType: keyof NonNullable<ClaudeSettings['hooks']>,
    scriptName: string,
    matcher: string = '.*',
  ): void => {
    if (addPanopticonHookIfMissing(settings, hookType, binDir, scriptName, matcher)) {
      added.push(`${hookType}:${scriptName}`);
    }
  };

  // PAN-982: PreToolUse, PostToolUse, and Stop hooks are NO LONGER registered in
  // global ~/.claude/settings.json. They were migrated into per-agent frontmatter
  // at agents/pan-<type>-agent.md so each Panopticon pipeline agent declares its
  // own tool-event hooks. Registering them again here would cause every event to
  // fire twice (once from frontmatter, once from global settings) — the exact
  // double-fire window the migration exists to close (PAN-982 hazard H4).
  //
  // Ad-hoc Claude sessions launched without --agent will no longer trigger
  // pre-tool-hook / heartbeat-hook / stop-hook / tldr-* / inspect-on-bead-close.
  // That is intentional: those hooks were Panopticon-specific (heartbeat tracking,
  // cost recording, bead-close detection) and have no meaning outside a pipeline
  // agent.
  //
  // The remaining hook events below stay in global settings because Claude Code's
  // agent frontmatter cannot host them reliably for the bootstrap path: they fire
  // before --agent is fully bound (SessionStart, UserPromptSubmit) or are session-
  // wide signals that need uniform routing across agent and ad-hoc sessions
  // (PreCompact/PostCompact/Notification/PermissionRequest).
  addHookIfMissing('SessionStart', 'session-start-hook');
  addHookIfMissing('Notification', 'notification-hook');
  addHookIfMissing('UserPromptSubmit', 'user-prompt-submit-hook');
  addHookIfMissing('PreCompact', 'pre-compact-hook');
  addHookIfMissing('PostCompact', 'post-compact-hook');
  addHookIfMissing('PermissionRequest', 'permission-event-hook');

  // PAN-982: Atomic migration — strip out any pre-existing PreToolUse / PostToolUse /
  // Stop / TLDR registrations that older Panopticon installs added to
  // ~/.claude/settings.json. Without this prune, users upgrading across PAN-982
  // would have BOTH global and per-agent hooks firing for every tool event,
  // doubling heartbeat/cost/inspect signals and tripping H4 (the dedup hazard
  // the bead exists to close). The prune is keyed on Panopticon's own bin/
  // paths, so user-authored hooks pointing elsewhere are left intact.
  const removed: string[] = [];
  const removeIfPresent = (
    hookType: keyof NonNullable<ClaudeSettings['hooks']>,
    scriptName: string,
  ): void => {
    if (removeHookIfPresent(settings, hookType, binDir, scriptName)) {
      removed.push(`${hookType}:${scriptName}`);
    }
  };
  removeIfPresent('PreToolUse', 'pre-tool-hook');
  removeIfPresent('PreToolUse', 'tldr-read-enforcer');
  removeIfPresent('PostToolUse', 'heartbeat-hook');
  removeIfPresent('PostToolUse', 'permission-event-hook');
  removeIfPresent('PostToolUse', 'tldr-post-edit');
  removeIfPresent('PostToolUse', 'inspect-on-bead-close');
  removeIfPresent('Stop', 'stop-hook');
  removeIfPresent('Stop', 'permission-event-hook');
  removeIfPresent('Stop', 'work-agent-stop-hook');
  removeIfPresent('Stop', 'specialist-stop-hook');
  if (removed.length > 0) {
    console.log(chalk.yellow(`\n✓ Migrated ${removed.length} legacy hook(s) to per-agent frontmatter:`));
    for (const entry of removed) console.log(chalk.dim(`  • ${entry}`));
  }

  if (added.length === 0) {
    console.log(chalk.cyan('\n✓ All Panopticon hooks already registered'));
  } else {
    console.log(chalk.green(`\n✓ Registered ${added.length} hook(s):`));
    for (const entry of added) console.log(chalk.dim(`  • ${entry}`));
  }

  // 8. Install caveman hook files and compress scripts to ~/.panopticon/hooks/caveman/
  try {
    const { setupCavemanHooks, setupCavemanCompressScripts } = await import('../../../lib/caveman/setup.js');
    const { Effect } = await import('effect');
    const cavemanOk = await Effect.runPromise(
      setupCavemanHooks().pipe(Effect.match({ onFailure: () => false, onSuccess: () => true })),
    );
    if (cavemanOk) {
      console.log(chalk.green('✓ Installed caveman hook files to ~/.panopticon/hooks/caveman/'));
    } else {
      console.log(chalk.yellow('⚠ Caveman hook files not found — skipping (non-fatal)'));
    }
    const compressOk = await Effect.runPromise(setupCavemanCompressScripts());
    if (compressOk) {
      console.log(chalk.green('✓ Installed caveman-compress scripts to ~/.panopticon/hooks/caveman-compress/'));
    }
  } catch (err: unknown) {
    console.log(chalk.yellow(`⚠ Caveman hook install failed: ${err instanceof Error ? err.message : String(err)} (non-fatal)`));
  }

  // 9. Write updated settings — PAN-1137: backup + atomic write + dry-run
  if (dryRun) {
    console.log(chalk.cyan('\nProposed settings.json diff:'));
    console.log(diffJson(beforeSnapshot, settings));
    console.log(chalk.cyan('\nDry run complete — no file changes written.'));
  } else {
    const backupPath = backupSettingsSync(settingsPath);
    if (backupPath) {
      console.log(chalk.dim(`✓ Backed up settings.json → ${backupPath}`));
    }
    atomicWriteJsonSync(settingsPath, settings);
    pruneBackupsSync(settingsPath);
    console.log(chalk.green('✓ Updated Claude Code settings.json'));
  }

  // 10. Success message
  console.log(chalk.green.bold('\n✓ Setup complete!\n'));
  console.log(chalk.dim('Claude Code hooks are now configured:'));
  console.log(chalk.dim('  • SessionStart      - Bootstraps agent state, emits model_set'));
  console.log(chalk.dim('  • UserPromptSubmit  - Clears waiting state, restarts spinner'));
  console.log(chalk.dim('  • PreCompact/Post   - Tracks compaction lifecycle'));
  console.log(chalk.dim('  • Notification      - Emits agent.waiting_started events'));
  console.log(chalk.dim('  • PermissionRequest - Surfaces permission prompts to dashboard'));
  console.log(chalk.dim('  PAN-982: PreToolUse/PostToolUse/Stop now live in per-agent frontmatter'));
  console.log(chalk.dim('           at agents/pan-<type>-agent.md (work, planning, review, ...).'));
  if (python3Available) {
    console.log(chalk.dim('  • TLDR MCP          - Token-efficient code analysis'));
  }
  console.log(chalk.dim('  • Caveman           - Compressed output hooks (activate with agents.caveman.enabled: true)'));
  console.log('');
  console.log(chalk.dim('When you run agents via `pan start`, they will report'));
  console.log(chalk.dim('their status in real-time to the Panopticon dashboard.\n'));
}
