import { existsSync, mkdirSync, readdirSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import { Effect } from 'effect';
import { INIT_DIRS, CONFIG_FILE, PANOPTICON_HOME, SKILLS_DIR, AGENTS_DIR } from '../../lib/paths.js';
import { getDefaultConfig, saveConfig } from '../../lib/config.js';
import { detectShell, getShellRcFile, addAlias, getAliasInstructions } from '../../lib/shell.js';

// Get the package root directory (where skills/ and agents/ live)
// Note: After bundling, code runs from dist/cli/index.js, so go up 2 levels
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, '..', '..'); // dist/cli -> dist -> package root
const BUNDLED_SKILLS_DIR = join(PACKAGE_ROOT, 'skills');
const BUNDLED_AGENTS_DIR = join(PACKAGE_ROOT, 'agents');

/**
 * Copy bundled skills from package to ~/.panopticon/skills/
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
 * Copy bundled agents from package to ~/.panopticon/agents/
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
  const spinner = ora('Initializing Panopticon...').start();

  // Check if already initialized
  if (existsSync(CONFIG_FILE)) {
    spinner.info('Panopticon already initialized');
    console.log(chalk.dim(`  Config: ${CONFIG_FILE}`));
    console.log(chalk.dim(`  Home: ${PANOPTICON_HOME}`));
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
    const shell = Effect.runSync(detectShell());
    const rcFile = Effect.runSync(getShellRcFile(shell));

    if (rcFile && existsSync(rcFile)) {
      Effect.runSync(addAlias(rcFile));
      spinner.succeed('Panopticon initialized!');
      console.log('');
      console.log(chalk.green('✓') + ' Created ' + chalk.cyan(PANOPTICON_HOME));
      console.log(chalk.green('✓') + ' Created ' + chalk.cyan(CONFIG_FILE));
      if (skillsCopied > 0) {
        console.log(chalk.green('✓') + ` Installed ${skillsCopied} bundled skills`);
      }
      if (agentsCopied > 0) {
        console.log(chalk.green('✓') + ` Installed ${agentsCopied} bundled agents`);
      }
      console.log(chalk.green('✓') + ' ' + Effect.runSync(getAliasInstructions(shell)));
    } else {
      spinner.succeed('Panopticon initialized!');
      console.log('');
      console.log(chalk.green('✓') + ' Created ' + chalk.cyan(PANOPTICON_HOME));
      console.log(chalk.green('✓') + ' Created ' + chalk.cyan(CONFIG_FILE));
      if (skillsCopied > 0) {
        console.log(chalk.green('✓') + ` Installed ${skillsCopied} bundled skills`);
      }
      if (agentsCopied > 0) {
        console.log(chalk.green('✓') + ` Installed ${agentsCopied} bundled agents`);
      }
      console.log(chalk.yellow('!') + ' Could not detect shell. Add alias manually:');
      console.log(chalk.dim('    alias pan="panopticon"'));
    }

    console.log('');
    console.log('Next steps:');
    console.log(chalk.dim('  1. Start dashboard: pan up (auto-syncs skills)'));

  } catch (error: any) {
    spinner.fail('Failed to initialize');
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}
