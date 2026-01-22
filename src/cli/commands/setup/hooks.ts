import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';

interface ClaudeSettings {
  hooks?: {
    PostToolUse?: Array<{
      matcher: string;
      command: string;
    }>;
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
 * Check if Panopticon heartbeat hook is already configured
 */
function hookAlreadyConfigured(settings: ClaudeSettings, hookPath: string): boolean {
  const postToolUse = settings?.hooks?.PostToolUse || [];
  return postToolUse.some((hook) =>
    hook.command === hookPath ||
    hook.command.includes('panopticon') ||
    hook.command.includes('heartbeat-hook')
  );
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

  // 3. Copy heartbeat-hook script to ~/.panopticon/bin/
  // Find the script in the Panopticon installation
  const scriptSource = join(process.cwd(), 'scripts', 'heartbeat-hook');
  const scriptDest = join(binDir, 'heartbeat-hook');

  // Check if script exists in cwd/scripts (development mode)
  let sourcePath = scriptSource;
  if (!existsSync(sourcePath)) {
    // Try finding it relative to CLI location (installed mode)
    const { fileURLToPath } = await import('url');
    const { dirname } = await import('path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const installedSource = join(__dirname, '..', '..', '..', 'scripts', 'heartbeat-hook');

    if (existsSync(installedSource)) {
      sourcePath = installedSource;
    } else {
      console.log(chalk.red('✗ Could not find heartbeat-hook script'));
      console.log(chalk.dim(`  Checked: ${scriptSource}`));
      console.log(chalk.dim(`  Checked: ${installedSource}`));
      process.exit(1);
    }
  }

  copyFileSync(sourcePath, scriptDest);
  chmodSync(scriptDest, 0o755); // Make executable
  console.log(chalk.green('✓ Installed heartbeat-hook script'));

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

  // 5. Check if hook is already configured
  if (hookAlreadyConfigured(settings, scriptDest)) {
    console.log(chalk.cyan('\n✓ Panopticon heartbeat hook already configured'));
    console.log(chalk.dim('  No changes needed\n'));
    return;
  }

  // 6. Add Panopticon hook to settings
  if (!settings.hooks) {
    settings.hooks = {};
  }

  if (!settings.hooks.PostToolUse) {
    settings.hooks.PostToolUse = [];
  }

  // Append Panopticon hook
  settings.hooks.PostToolUse.push({
    matcher: '.*',
    command: scriptDest
  });

  // 7. Write updated settings
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log(chalk.green('✓ Updated Claude Code settings.json'));

  // 8. Success message
  console.log(chalk.green.bold('\n✓ Setup complete!\n'));
  console.log(chalk.dim('Heartbeat hooks are now active. When you run agents via'));
  console.log(chalk.dim('`pan work issue`, they will send real-time activity updates'));
  console.log(chalk.dim('to the Panopticon dashboard.\n'));
}
