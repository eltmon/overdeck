import { Effect } from 'effect';
import chalk from 'chalk';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from 'fs';
import { join, dirname } from 'path';
import { execFileSync, execSync } from 'child_process';
import { arch as osArch, homedir, platform as osPlatform, tmpdir } from 'os';
import { createHash } from 'crypto';
import { readSettingsOrAbortSync, backupSettingsSync, pruneBackupsSync, atomicWriteJsonSync, diffJson } from './safe-settings.js';
import { SYNC_SOURCES } from '../../../lib/paths.js';

const RTK_VERSION = '0.41.0';
const RTK_RELEASE_TAG = `v${RTK_VERSION}`;
const RTK_RELEASE_BASE_URL = `https://github.com/rtk-ai/rtk/releases/download/${RTK_RELEASE_TAG}`;

interface RtkReleaseAsset {
  assetName: string;
  sha256: string;
}

const RTK_ASSETS: Record<string, RtkReleaseAsset> = {
  'linux-x64': {
    assetName: 'rtk-x86_64-unknown-linux-musl.tar.gz',
    sha256: '90ae10f5c76de9bacaec5eeeefb6012f74dd47f4e280ec614295555b64da6b57',
  },
  'linux-arm64': {
    assetName: 'rtk-aarch64-unknown-linux-gnu.tar.gz',
    sha256: '68d6fedfd76f16437eb79cb659169ef8bc3994124486cc71d9479a1b241b7812',
  },
  'darwin-arm64': {
    assetName: 'rtk-aarch64-apple-darwin.tar.gz',
    sha256: '8b9751f927da4fb433be23f24f205bf1c22f9dd6949790c0980d2cc91b14658c',
  },
  'darwin-x64': {
    assetName: 'rtk-x86_64-apple-darwin.tar.gz',
    sha256: 'b2729d9983b38af77824a5c7a3c23de415533be9fb022a5e473904ecc9620db9',
  },
};

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

function getRtkReleaseAsset(): RtkReleaseAsset | null {
  const key = `${osPlatform()}-${osArch()}`;
  return RTK_ASSETS[key] ?? null;
}

function readInstalledRtkVersion(rtkPath: string): string | null {
  try {
    return execFileSync(rtkPath, ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

async function installRtk(binDir: string): Promise<boolean> {
  const asset = getRtkReleaseAsset();
  if (!asset) {
    console.log(
      chalk.yellow(`⚠ RTK prebuilt binary unavailable for ${osPlatform()}-${osArch()} — skipping`),
    );
    return false;
  }

  const rtkPath = join(binDir, 'rtk');
  const expectedVersion = `rtk ${RTK_VERSION}`;
  if (existsSync(rtkPath) && readInstalledRtkVersion(rtkPath) === expectedVersion) {
    console.log(chalk.cyan(`✓ RTK ${RTK_VERSION} already installed`));
    return true;
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'pan-rtk-'));
  try {
    const archiveUrl = `${RTK_RELEASE_BASE_URL}/${asset.assetName}`;
    const response = await fetch(archiveUrl);
    if (!response.ok) {
      throw new Error(`download failed: ${response.status} ${response.statusText}`);
    }

    const archiveBytes = Buffer.from(await response.arrayBuffer());
    const actualSha = createHash('sha256').update(archiveBytes).digest('hex');
    if (actualSha !== asset.sha256) {
      throw new Error(`checksum mismatch for ${asset.assetName}`);
    }

    const archivePath = join(tempDir, asset.assetName);
    writeFileSync(archivePath, archiveBytes);
    execFileSync('tar', ['-xzf', archivePath, '-C', tempDir], { stdio: 'pipe' });

    const extractedRtk = join(tempDir, 'rtk');
    if (!existsSync(extractedRtk)) {
      throw new Error(`archive did not contain rtk binary`);
    }

    chmodSync(extractedRtk, 0o755);
    renameSync(extractedRtk, rtkPath);
    const installedVersion = readInstalledRtkVersion(rtkPath);
    if (installedVersion !== expectedVersion) {
      throw new Error(`rtk --version returned ${installedVersion ?? 'no output'}`);
    }

    console.log(chalk.green(`✓ Installed RTK ${RTK_VERSION} to ~/.overdeck/bin/rtk`));
    return true;
  } catch (err: unknown) {
    console.log(
      chalk.yellow(`⚠ RTK install failed: ${err instanceof Error ? err.message : String(err)} (non-fatal)`),
    );
    return false;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Per-hook-type detection of whether a Overdeck hook is already registered.
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
      (hook.command?.includes(`overdeck/bin/${scriptName}`) ?? false)
    )
  );
}

export function addOverdeckHookIfMissing(
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


export type HookHarness = 'claude-code' | 'pi' | 'codex' | 'both';

export interface SetupHooksOptions {
  /**
   * Preview the proposed settings.json diff and exit without writing.
   * Hook scripts and directories are still installed; only the
   * settings.json mutation is skipped. (PAN-1137)
   */
  dryRun?: boolean;
  harness?: HookHarness;
}

function commandExists(name: string): boolean {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function detectInstalledHookHarnesses(): { claudeCode: boolean; pi: boolean } {
  return { claudeCode: commandExists('claude'), pi: commandExists('pi') };
}

function resolveHookHarnessSelection(requested: HookHarness | undefined): HookHarness {
  if (requested) return requested;
  const detected = detectInstalledHookHarnesses();
  if (detected.claudeCode && detected.pi) return 'both';
  if (detected.pi) return 'pi';
  return 'claude-code';
}

function verifyPiExtensionBuilt(): boolean {
  const extensionPath = join(process.cwd(), 'packages', 'pi-extension', 'dist', 'index.js');
  if (existsSync(extensionPath)) {
    console.log(chalk.green('✓ Pi extension build found'));
    return true;
  }
  console.log(chalk.yellow('⚠ Pi extension build not found'));
  console.log(chalk.dim('  Run: cd packages/pi-extension && npm run build'));
  return false;
}

export function parseHookHarness(value: string | undefined): HookHarness | undefined {
  if (value === undefined) return undefined;
  if (value === 'claude-code' || value === 'pi' || value === 'codex' || value === 'both') return value;
  throw new Error(`Invalid harness "${value}". Expected claude-code, pi, codex, or both.`);
}

export function hooksStatusCommand(): void {
  const detected = detectInstalledHookHarnesses();
  console.log(chalk.bold('Overdeck hook harness status\n'));
  console.log(`${detected.claudeCode ? '✓' : '○'} Claude Code binary: ${detected.claudeCode ? 'installed' : 'not found'}`);
  console.log(`${detected.pi ? '✓' : '○'} Pi binary: ${detected.pi ? 'installed' : 'not found'}`);
  verifyPiExtensionBuilt();
}

/**
 * Setup Claude Code / Pi hooks for Overdeck heartbeat
 */
export async function setupHooksCommand(opts: SetupHooksOptions = {}): Promise<void> {
  const dryRun = opts.dryRun === true;
  const harness = resolveHookHarnessSelection(opts.harness);
  console.log(chalk.bold('Setting up Overdeck heartbeat hooks\n'));
  console.log(chalk.dim(`Harness target: ${harness}\n`));

  if (harness === 'pi' || harness === 'both') {
    verifyPiExtensionBuilt();
  }

  if (harness === 'pi') {
    console.log(chalk.green('\n✓ Pi hook extension check complete'));
    return;
  }

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

  // 2. Ensure ~/.overdeck/bin directory exists
  const overdeckHome = join(homedir(), '.overdeck');
  const binDir = join(overdeckHome, 'bin');
  const heartbeatsDir = join(overdeckHome, 'heartbeats');

  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
    console.log(chalk.green('✓ Created ~/.overdeck/bin/'));
  }

  if (!existsSync(heartbeatsDir)) {
    mkdirSync(heartbeatsDir, { recursive: true });
    console.log(chalk.green('✓ Created ~/.overdeck/heartbeats/'));
  }

  // 3. Copy hook scripts to ~/.overdeck/bin/
  const hookScripts = [
    'pan-hook-lib.sh',        // PAN-800: shared library sourced by all hooks
    'pre-tool-hook',
    'ask-user-question-hook',
    'auto-approve-hook',
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
    'gh-issue-trailer-hook',
    'gh-issue-trailer-hook.js',
    'tldr-read-enforcer',
    'tldr-post-edit',
    'rtk-bash-filter',
    'permission-event-hook',   // PermissionRequest — emits conversation.permission_changed(waiting)
    'tmux-send-keys-guard',    // PAN-1084: blocks work agents from driving other agents' tmux sessions
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
    if (addOverdeckHookIfMissing(settings, hookType, binDir, scriptName, matcher)) {
      added.push(`${hookType}:${scriptName}`);
    }
  };

  // PAN-1402: Tool-event hooks briefly lived in per-agent frontmatter during
  // PAN-982, but Claude Code did not honor them when Overdeck invoked agents
  // with path-form `--agent roles/<role>.md`, so these registrations are global.
  // PAN-2087: path-form `--agent` is gone entirely (Claude Code 2.1.195 dropped
  // file support; roles are now injected via --append-system-prompt-file), so
  // global registration here is the ONLY hook delivery path — keep it.
  addHookIfMissing('PreToolUse', 'pre-tool-hook');
  // Auto-approve tool calls for Overdeck agents (self-scoped via
  // OVERDECK_AGENT_ID inside the hook) — replaces launching agents with
  // --dangerously-skip-permissions so headless agents never hang on Claude
  // Code's "Do you want to proceed?" prompt (PAN-1024). A frontmatter PreToolUse
  // hook's permissionDecision is NOT honored, so this must be registered here in
  // settings.json. AskUserQuestion is skipped by the hook so ask-user-question-hook's
  // deny still wins.
  addHookIfMissing('PreToolUse', 'auto-approve-hook');
  addHookIfMissing('PreToolUse', 'gh-issue-trailer-hook', 'Bash');
  // PAN-1084: mechanically prevent work agents from self-approving permission
  // prompts in another agent's tmux session via tmux send-keys/paste-buffer.
  addHookIfMissing('PreToolUse', 'tmux-send-keys-guard', 'Bash');
  // PAN-1520: block AskUserQuestion to prevent upstream silent-corruption
  // (option #1 fabricated as answer under --dangerously-skip-permissions).
  addHookIfMissing('PreToolUse', 'ask-user-question-hook', 'AskUserQuestion');
  addHookIfMissing('PostToolUse', 'heartbeat-hook');
  addHookIfMissing('PostToolUse', 'permission-event-hook');
  addHookIfMissing('Stop', 'stop-hook');
  addHookIfMissing('Stop', 'permission-event-hook');
  addHookIfMissing('SessionStart', 'session-start-hook');
  addHookIfMissing('Notification', 'notification-hook');
  addHookIfMissing('UserPromptSubmit', 'user-prompt-submit-hook');
  addHookIfMissing('PreCompact', 'pre-compact-hook');
  addHookIfMissing('PostCompact', 'post-compact-hook');
  addHookIfMissing('PermissionRequest', 'permission-event-hook');
  if (python3Available) {
    addHookIfMissing('PreToolUse', 'tldr-read-enforcer', 'Read');
    addHookIfMissing('PostToolUse', 'tldr-post-edit', 'Edit|Write');
  }

  if (added.length === 0) {
    console.log(chalk.cyan('\n✓ All Overdeck hooks already registered'));
  } else {
    console.log(chalk.green(`\n✓ Registered ${added.length} hook(s):`));
    for (const entry of added) console.log(chalk.dim(`  • ${entry}`));
  }

  // 8. Install caveman hook files and compress scripts to ~/.overdeck/hooks/caveman/
  try {
    const { setupCavemanHooks, setupCavemanCompressScripts } = await import('../../../lib/caveman/setup.js');
    const { Effect } = await import('effect');
    const cavemanOk = await Effect.runPromise(
      setupCavemanHooks().pipe(Effect.match({ onFailure: () => false, onSuccess: () => true })),
    );
    if (cavemanOk) {
      console.log(chalk.green('✓ Installed caveman hook files to ~/.overdeck/hooks/caveman/'));
    } else {
      console.log(chalk.yellow('⚠ Caveman hook files not found — skipping (non-fatal)'));
    }
    const compressOk = await Effect.runPromise(setupCavemanCompressScripts());
    if (compressOk) {
      console.log(chalk.green('✓ Installed caveman-compress scripts to ~/.overdeck/hooks/caveman-compress/'));
    }
  } catch (err: unknown) {
    console.log(chalk.yellow(`⚠ Caveman hook install failed: ${err instanceof Error ? err.message : String(err)} (non-fatal)`));
  }

  await installRtk(binDir);

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
  console.log(chalk.dim('  • PreToolUse        - Records tool usage before tools run'));
  console.log(chalk.dim('  • PostToolUse       - Emits heartbeats and tool/permission events'));
  console.log(chalk.dim('  • Stop              - Records session stop and permission lifecycle events'));
  console.log(chalk.dim('  • SessionStart      - Bootstraps agent state, emits model_set'));
  console.log(chalk.dim('  • UserPromptSubmit  - Clears waiting state, restarts spinner'));
  console.log(chalk.dim('  • PreCompact/Post   - Tracks compaction lifecycle'));
  console.log(chalk.dim('  • Notification      - Emits agent.waiting_started events'));
  console.log(chalk.dim('  • PermissionRequest - Surfaces permission prompts to dashboard'));
  if (python3Available) {
    console.log(chalk.dim('  • TLDR hooks        - Enforce token-efficient reads and post-edit updates'));
    console.log(chalk.dim('  • TLDR MCP          - Token-efficient code analysis'));
  }
  console.log(chalk.dim('  • Caveman           - Compressed output hooks (activate with agents.caveman.enabled: true)'));
  console.log(chalk.dim('  • RTK Bash filter   - Token-efficient Bash output hooks (activate with agents.rtk.enabled: true)'));
  console.log('');
  console.log(chalk.dim('When you run agents via `pan start`, they will report'));
  console.log(chalk.dim('their status in real-time to the Overdeck dashboard.\n'));
}
