import { exitCli } from '../exit.js';
import { existsSync, mkdirSync, readdirSync, cpSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { INIT_DIRS, CONFIG_FILE, OVERDECK_HOME, SKILLS_DIR, AGENTS_DIR, packageRoot } from '../../lib/paths.js';
import { getDefaultConfig, saveConfig } from '../../lib/config.js';
import { detectShell, getShellRcFile, addAlias, getAliasInstructions } from '../../lib/shell.js';

// The package root (where skills/ and agents/ live). Resolved by lib/paths, not
// from this module's URL: the CLI loads command modules lazily as dist/ chunks
// (PAN-4195), so a relative walk from import.meta.url is location-dependent.
const PACKAGE_ROOT = packageRoot;
const BUNDLED_SKILLS_DIR = join(PACKAGE_ROOT, 'skills');
const BUNDLED_AGENTS_DIR = join(PACKAGE_ROOT, 'agents');

/**
 * Copy bundled skills from package to ~/.overdeck/skills/
 * Returns the number of skills copied
 */
function copyBundledSkills(): number {
  if (!existsSync(BUNDLED_SKILLS_DIR)) {
    return 0;
  }

  // Ensure skills directory exists
  if (!existsSync(SKILLS_DIR)) {
    mkdirSync(SKILLS_DIR, { recursive: true });
  }

  const skills = readdirSync(BUNDLED_SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  let copied = 0;
  for (const skill of skills) {
    const sourcePath = join(BUNDLED_SKILLS_DIR, skill.name);
    const targetPath = join(SKILLS_DIR, skill.name);

    // Copy skill directory (overwrites existing)
    cpSync(sourcePath, targetPath, { recursive: true });
    copied++;
  }

  return copied;
}

/**
 * Copy bundled agents from package to ~/.overdeck/agents/
 * Returns the number of agents copied
 */
function copyBundledAgents(): number {
  if (!existsSync(BUNDLED_AGENTS_DIR)) {
    return 0;
  }

  // Ensure agents directory exists
  if (!existsSync(AGENTS_DIR)) {
    mkdirSync(AGENTS_DIR, { recursive: true });
  }

  const agents = readdirSync(BUNDLED_AGENTS_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'));

  let copied = 0;
  for (const agent of agents) {
    const sourcePath = join(BUNDLED_AGENTS_DIR, agent.name);
    const targetPath = join(AGENTS_DIR, agent.name);

    // Copy agent file (overwrites existing)
    cpSync(sourcePath, targetPath);
    copied++;
  }

  return copied;
}

export async function initCommand(): Promise<void> {
  const spinner = ora('Initializing Overdeck...').start();

  // Check if already initialized
  if (existsSync(CONFIG_FILE)) {
    spinner.info('Overdeck already initialized');
    console.log(chalk.dim(`  Config: ${CONFIG_FILE}`));
    console.log(chalk.dim(`  Home: ${OVERDECK_HOME}`));
    console.log(chalk.dim('  Run `pan sync` to update skills'));
    return;
  }

  try {
    // Create all directories
    for (const dir of INIT_DIRS) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
    spinner.text = 'Created directories...';

    // Write default config
    const config = getDefaultConfig();
    saveConfig(config);
    spinner.text = 'Created config...';

    // Copy bundled skills from package
    spinner.text = 'Installing bundled skills...';
    const skillsCopied = copyBundledSkills();

    // Copy bundled agents from package
    spinner.text = 'Installing bundled agents...';
    const agentsCopied = copyBundledAgents();

    // Detect shell and add alias
    const shell = detectShell();
    const rcFile = getShellRcFile(shell);

    if (rcFile && existsSync(rcFile)) {
      addAlias(rcFile);
      spinner.succeed('Overdeck initialized!');
      console.log('');
      console.log(chalk.green('✓') + ' Created ' + chalk.cyan(OVERDECK_HOME));
      console.log(chalk.green('✓') + ' Created ' + chalk.cyan(CONFIG_FILE));
      if (skillsCopied > 0) {
        console.log(chalk.green('✓') + ` Installed ${skillsCopied} bundled skills`);
      }
      if (agentsCopied > 0) {
        console.log(chalk.green('✓') + ` Installed ${agentsCopied} bundled agents`);
      }
      console.log(chalk.green('✓') + ' ' + getAliasInstructions(shell));
    } else {
      spinner.succeed('Overdeck initialized!');
      console.log('');
      console.log(chalk.green('✓') + ' Created ' + chalk.cyan(OVERDECK_HOME));
      console.log(chalk.green('✓') + ' Created ' + chalk.cyan(CONFIG_FILE));
      if (skillsCopied > 0) {
        console.log(chalk.green('✓') + ` Installed ${skillsCopied} bundled skills`);
      }
      if (agentsCopied > 0) {
        console.log(chalk.green('✓') + ` Installed ${agentsCopied} bundled agents`);
      }
      console.log(chalk.yellow('!') + ' Could not detect shell. Add alias manually:');
      console.log(chalk.dim('    alias pan="overdeck"'));
    }

    console.log('');
    console.log('Next steps:');
    console.log(chalk.dim('  1. Start dashboard: pan up (auto-syncs skills)'));

  } catch (error: any) {
    spinner.fail('Failed to initialize');
    console.error(chalk.red(error.message));
    return exitCli(1);
  }
}
