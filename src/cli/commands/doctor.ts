import chalk from 'chalk';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { listSessionNames } from '../../lib/tmux.js';
import { homedir } from 'os';
import { join } from 'path';
import {
  PANOPTICON_HOME,
  SKILLS_DIR,
  COMMANDS_DIR,
  AGENTS_DIR,
  CLAUDE_DIR,
  packageRoot,
} from '../../lib/paths.js';

// Minimum supported Pi binary version for the Pi harness (PAN-636).
// Bump in lockstep with packages/pi-extension API surface compatibility.
export const SUPPORTED_PI_VERSION_MIN = '0.73.0';

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export function checkPi(strict: boolean): CheckResult[] {
  const out: CheckResult[] = [];
  if (!checkCommand('pi')) {
    out.push({
      name: 'Pi Coding Agent',
      status: strict ? 'error' : 'warn',
      message: 'Not installed (optional alternative harness)',
      fix: 'Install: npm install -g @mariozechner/pi-coding-agent',
    });
    return out;
  }

  const version = readPiVersion();
  if (!version) {
    out.push({
      name: 'Pi Coding Agent',
      status: 'warn',
      message: 'Detected but `pi --version` did not return a version string',
      fix: 'Reinstall: npm install -g @mariozechner/pi-coding-agent',
    });
  } else if (compareSemver(version, SUPPORTED_PI_VERSION_MIN) < 0) {
    out.push({
      name: 'Pi Coding Agent',
      status: 'error',
      message: `v${version} (too old — requires >= ${SUPPORTED_PI_VERSION_MIN})`,
      fix: 'Upgrade: npm install -g @mariozechner/pi-coding-agent@latest',
    });
  } else {
    out.push({
      name: 'Pi Coding Agent',
      status: 'ok',
      message: `v${version}`,
    });
  }

  const extensionDist = join(packageRoot, 'packages', 'pi-extension', 'dist', 'index.js');
  if (!existsSync(extensionDist)) {
    out.push({
      name: 'Pi Extension Bundle',
      status: 'warn',
      message: 'packages/pi-extension/dist/index.js not found',
      fix: 'Build it: cd packages/pi-extension && npm run build',
    });
  } else {
    out.push({
      name: 'Pi Extension Bundle',
      status: 'ok',
      message: 'packages/pi-extension/dist/index.js present',
    });
  }
  return out;
}

function readPiVersion(): string | null {
  // Pi prints its version to stderr, not stdout — merge both streams.
  try {
    const out = execSync('pi --version 2>&1', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    const m = out.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

function checkCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkDirectory(path: string): boolean {
  return existsSync(path);
}

function countItems(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    return readdirSync(path).length;
  } catch {
    return 0;
  }
}

export interface DoctorOptions {
  strict?: boolean;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  console.log(chalk.bold('\nPanopticon Doctor\n'));
  console.log(chalk.dim('Checking system health...\n'));

  const checks: CheckResult[] = [];

  // Check required commands
  const requiredCommands = [
    { cmd: 'git', name: 'Git', fix: 'Install git' },
    { cmd: 'tmux', name: 'tmux', fix: 'Install tmux: apt install tmux / brew install tmux' },
    { cmd: 'node', name: 'Node.js', fix: 'Install Node.js 18+' },
    { cmd: 'claude', name: 'Claude CLI', fix: 'Install: npm install -g @anthropic-ai/claude-code' },
  ];

  for (const { cmd, name, fix } of requiredCommands) {
    if (checkCommand(cmd)) {
      checks.push({ name, status: 'ok', message: 'Installed' });
    } else {
      checks.push({ name, status: 'error', message: 'Not found', fix });
    }
  }

  // Check optional commands
  const optionalCommands = [
    { cmd: 'gh', name: 'GitHub CLI', fix: 'Install: gh auth login' },
    { cmd: 'bd', name: 'Beads CLI', fix: 'Install beads for task tracking' },
    { cmd: 'docker', name: 'Docker', fix: 'Install Docker for workspace containers' },
  ];

  for (const { cmd, name, fix } of optionalCommands) {
    if (checkCommand(cmd)) {
      checks.push({ name, status: 'ok', message: 'Installed' });
    } else {
      checks.push({ name, status: 'warn', message: 'Not installed (optional)', fix });
    }
  }

  // Pi Coding Agent (alternative harness — PAN-636).
  // Pi is optional: missing → warn (or error under --strict). When installed, version
  // is compared against SUPPORTED_PI_VERSION_MIN and the bundled extension is checked.
  for (const c of checkPi(options.strict ?? false)) checks.push(c);

  // Check Panopticon directories
  const directories = [
    { path: PANOPTICON_HOME, name: 'Panopticon Home', fix: 'Run: pan init' },
    { path: SKILLS_DIR, name: 'Skills Directory', fix: 'Run: pan init' },
    { path: COMMANDS_DIR, name: 'Commands Directory', fix: 'Run: pan init' },
    { path: AGENTS_DIR, name: 'Agents Directory', fix: 'Run: pan init' },
  ];

  for (const { path, name, fix } of directories) {
    if (checkDirectory(path)) {
      const count = countItems(path);
      checks.push({ name, status: 'ok', message: `Exists (${count} items)` });
    } else {
      checks.push({ name, status: 'error', message: 'Missing', fix });
    }
  }

  // Check Claude Code integration
  if (checkDirectory(CLAUDE_DIR)) {
    const skillsCount = countItems(join(CLAUDE_DIR, 'skills'));
    const commandsCount = countItems(join(CLAUDE_DIR, 'commands'));
    checks.push({
      name: 'Claude Code Skills',
      status: skillsCount > 0 ? 'ok' : 'warn',
      message: `${skillsCount} skills`,
      fix: skillsCount === 0 ? 'Run: pan sync' : undefined,
    });
    checks.push({
      name: 'Claude Code Commands',
      status: commandsCount > 0 ? 'ok' : 'warn',
      message: `${commandsCount} commands`,
      fix: commandsCount === 0 ? 'Run: pan sync' : undefined,
    });
  } else {
    checks.push({
      name: 'Claude Code Directory',
      status: 'warn',
      message: 'Not found',
      fix: 'Install Claude Code first',
    });
  }

  // Check environment variables
  const envFile = join(homedir(), '.panopticon.env');
  if (existsSync(envFile)) {
    checks.push({ name: 'Config File', status: 'ok', message: '~/.panopticon.env exists' });
  } else {
    checks.push({
      name: 'Config File',
      status: 'warn',
      message: '~/.panopticon.env not found',
      fix: 'Create ~/.panopticon.env with LINEAR_API_KEY=...',
    });
  }

  // Check for LINEAR_API_KEY
  if (process.env.LINEAR_API_KEY) {
    checks.push({ name: 'LINEAR_API_KEY', status: 'ok', message: 'Set in environment' });
  } else if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    if (content.includes('LINEAR_API_KEY')) {
      checks.push({ name: 'LINEAR_API_KEY', status: 'ok', message: 'Set in config file' });
    } else {
      checks.push({
        name: 'LINEAR_API_KEY',
        status: 'warn',
        message: 'Not configured',
        fix: 'Add LINEAR_API_KEY to ~/.panopticon.env',
      });
    }
  } else {
    checks.push({
      name: 'LINEAR_API_KEY',
      status: 'warn',
      message: 'Not configured',
      fix: 'Set LINEAR_API_KEY environment variable or add to ~/.panopticon.env',
    });
  }

  // Check tmux sessions
  try {
    const agentSessions = listSessionNames().filter((s) => s.includes('agent-')).length;
    checks.push({
      name: 'Running Agents',
      status: 'ok',
      message: `${agentSessions} agent sessions`,
    });
  } catch {
    checks.push({
      name: 'Running Agents',
      status: 'ok',
      message: '0 agent sessions',
    });
  }

  // Check smee-client webhook relay
  try {
    const { isSmeeProcessRunning } = await import('../../lib/smee.js');
    const smeeUrlPath = join(homedir(), '.panopticon', 'github-app', 'smee-url');
    if (!existsSync(smeeUrlPath)) {
      checks.push({
        name: 'smee-client Webhook Relay',
        status: 'warn',
        message: 'Not configured (optional)',
        fix: 'Create ~/.panopticon/github-app/smee-url with your smee.io channel URL',
      });
    } else if (isSmeeProcessRunning()) {
      checks.push({
        name: 'smee-client Webhook Relay',
        status: 'ok',
        message: 'Running',
      });
    } else {
      checks.push({
        name: 'smee-client Webhook Relay',
        status: 'warn',
        message: 'Configured but not running',
        fix: 'Run `pan up` to start the webhook relay',
      });
    }
  } catch {
    checks.push({
      name: 'smee-client Webhook Relay',
      status: 'warn',
      message: 'Status check failed',
    });
  }

  // Check for legacy command invocations in shell rc files (PAN-705)
  const legacyPatterns = [
    'pan work ',
    'pan plan-finalize',
    'pan admin hooks install',
    'pan sync-costs',
    'pan cloister ',
    'pan specialists ',
    'pan admin migrate-config',
  ];
  const shellRcFiles = [
    join(homedir(), '.bashrc'),
    join(homedir(), '.bash_profile'),
    join(homedir(), '.zshrc'),
    join(homedir(), '.profile'),
    join(homedir(), '.bash_aliases'),
  ].filter(existsSync);

  const legacyFound: string[] = [];
  for (const rcFile of shellRcFiles) {
    try {
      const content = readFileSync(rcFile, 'utf-8');
      for (const pattern of legacyPatterns) {
        if (content.includes(pattern)) {
          legacyFound.push(`${rcFile.replace(homedir(), '~')} contains "${pattern}"`);
        }
      }
    } catch { /* ignore unreadable files */ }
  }

  if (legacyFound.length === 0) {
    checks.push({
      name: 'Legacy Command Aliases',
      status: 'ok',
      message: 'No legacy pan work/* aliases found in shell config',
    });
  } else {
    checks.push({
      name: 'Legacy Command Aliases',
      status: 'warn',
      message: `Found ${legacyFound.length} legacy command reference(s) in shell config`,
      fix: `Update the following to use 0.7.0 commands (see pan --help or QUICK-REFERENCE.md):\n  ${legacyFound.join('\n  ')}`,
    });
  }

  // Print results
  const icons = {
    ok: chalk.green('\u2713'),
    warn: chalk.yellow('\u26a0'),
    error: chalk.red('\u2717'),
  };

  let hasErrors = false;
  let hasWarnings = false;

  for (const check of checks) {
    const icon = icons[check.status];
    const message = check.status === 'error' ? chalk.red(check.message) :
                    check.status === 'warn' ? chalk.yellow(check.message) :
                    chalk.dim(check.message);

    console.log(`${icon} ${check.name}: ${message}`);

    if (check.fix && check.status !== 'ok') {
      console.log(chalk.dim(`  Fix: ${check.fix}`));
    }

    if (check.status === 'error') hasErrors = true;
    if (check.status === 'warn') hasWarnings = true;
  }

  console.log('');

  if (hasErrors) {
    console.log(chalk.red('Some required components are missing.'));
    console.log(chalk.dim('Fix the errors above before using Panopticon.'));
  } else if (hasWarnings) {
    console.log(chalk.yellow('System is functional with some optional features missing.'));
  } else {
    console.log(chalk.green('All systems operational!'));
  }
  console.log('');

  if (hasErrors) {
    process.exit(1);
  }
  if (options.strict && hasWarnings) {
    process.exit(1);
  }
}
