import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';

interface HookConfig {
  matcher: string;  // Regex pattern, e.g. ".*" for all tools or "Bash" for specific
  hooks: Array<{
    type: string;
    command: string;
  }>;
}

interface ClaudeSettings {
  hooks?: {
    PreToolUse?: HookConfig[];
    PostToolUse?: HookConfig[];
    Stop?: HookConfig[];
  };
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
 * Check if Panopticon hooks are already configured
 */
function hooksAlreadyConfigured(settings: ClaudeSettings, binDir: string): boolean {
  const hookTypes: Array<keyof ClaudeSettings['hooks']> = ['PreToolUse', 'PostToolUse', 'Stop'];

  for (const hookType of hookTypes) {
    const hooks = settings?.hooks?.[hookType] || [];
    const hasHook = hooks.some((hookConfig) =>
      hookConfig.hooks?.some((hook) =>
        hook.command?.includes('panopticon') ||
        hook.command?.includes(binDir)
      )
    );

    if (hasHook) {
      return true; // At least one hook type is configured
    }
  }

  return false;
}

/**
 * Setup Claude Code hooks for Panopticon heartbeat
 */
export async function setupHooksCommand(): Promise<void> {
  console.log(chalk.bold('Setting up Panopticon heartbeat hooks\n'));

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
  const hookScripts = ['pre-tool-hook', 'heartbeat-hook', 'stop-hook', 'specialist-stop-hook'];
  const { fileURLToPath } = await import('url');
  const { dirname } = await import('path');
  const __dirname = dirname(fileURLToPath(import.meta.url));

  for (const scriptName of hookScripts) {
    // Find the script in the Panopticon installation
    const devSource = join(process.cwd(), 'scripts', scriptName);
    const installedSource = join(__dirname, '..', '..', '..', 'scripts', scriptName);
    const scriptDest = join(binDir, scriptName);

    // Check if script exists (try dev mode first, then installed mode)
    let sourcePath: string | null = null;
    if (existsSync(devSource)) {
      sourcePath = devSource;
    } else if (existsSync(installedSource)) {
      sourcePath = installedSource;
    }

    if (!sourcePath) {
      console.log(chalk.red(`✗ Could not find ${scriptName} script`));
      console.log(chalk.dim(`  Checked: ${devSource}`));
      console.log(chalk.dim(`  Checked: ${installedSource}`));
      process.exit(1);
    }

    copyFileSync(sourcePath, scriptDest);
    chmodSync(scriptDest, 0o755); // Make executable
  }

  console.log(chalk.green('✓ Installed hook scripts (pre-tool, post-tool, stop, specialist-stop)'));

  // 4. Read or create Claude Code settings.json
  const claudeDir = join(homedir(), '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  let settings: ClaudeSettings = {};

  if (existsSync(settingsPath)) {
    try {
      const settingsContent = readFileSync(settingsPath, 'utf-8');
      settings = JSON.parse(settingsContent);
      console.log(chalk.green('✓ Read existing Claude Code settings'));
    } catch (error) {
      console.log(chalk.yellow('⚠ Could not parse settings.json, creating new file'));
      settings = {};
    }
  } else {
    console.log(chalk.dim('No existing settings.json found, creating new file'));
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }
  }

  // 5. Check if hooks are already configured
  if (hooksAlreadyConfigured(settings, binDir)) {
    console.log(chalk.cyan('\n✓ Panopticon hooks already configured'));
    console.log(chalk.dim('  No changes needed\n'));
    return;
  }

  // 6. Add Panopticon hooks to settings
  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Configure PreToolUse hook (sets state to "active")
  if (!settings.hooks.PreToolUse) {
    settings.hooks.PreToolUse = [];
  }
  settings.hooks.PreToolUse.push({
    matcher: '.*',
    hooks: [
      {
        type: 'command',
        command: join(binDir, 'pre-tool-hook')
      }
    ]
  });

  // Configure PostToolUse hook (logs activity)
  if (!settings.hooks.PostToolUse) {
    settings.hooks.PostToolUse = [];
  }
  settings.hooks.PostToolUse.push({
    matcher: '.*',
    hooks: [
      {
        type: 'command',
        command: join(binDir, 'heartbeat-hook')
      }
    ]
  });

  // Configure Stop hook (sets state to "idle")
  if (!settings.hooks.Stop) {
    settings.hooks.Stop = [];
  }
  settings.hooks.Stop.push({
    matcher: '.*',
    hooks: [
      {
        type: 'command',
        command: join(binDir, 'stop-hook')
      }
    ]
  });

  // 7. Write updated settings
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log(chalk.green('✓ Updated Claude Code settings.json'));

  // 8. Success message
  console.log(chalk.green.bold('\n✓ Setup complete!\n'));
  console.log(chalk.dim('Claude Code hooks are now configured:'));
  console.log(chalk.dim('  • PreToolUse  - Sets agent state to "active"'));
  console.log(chalk.dim('  • PostToolUse - Logs activity to activity.jsonl'));
  console.log(chalk.dim('  • Stop       - Sets agent state to "idle"\n'));
  console.log(chalk.dim('When you run agents via `pan work issue`, they will report'));
  console.log(chalk.dim('their status in real-time to the Panopticon dashboard.\n'));
}
