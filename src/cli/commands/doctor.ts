import chalk from 'chalk';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import {
  PANOPTICON_HOME,
  SKILLS_DIR,
  COMMANDS_DIR,
  AGENTS_DIR,
  CLAUDE_DIR,
} from '../../lib/paths.js';

interface CheckResult {
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

export async function doctorCommand(): Promise<void> {
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
    const sessions = execSync('tmux list-sessions 2>/dev/null || true', { encoding: 'utf-8' });
    const agentSessions = sessions.split('\n').filter((s) => s.includes('agent-')).length;
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
}
