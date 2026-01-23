import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import {
  PANOPTICON_HOME,
  INIT_DIRS,
  CERTS_DIR,
  TRAEFIK_DIR,
  TRAEFIK_DYNAMIC_DIR,
  TRAEFIK_CERTS_DIR,
  SKILLS_DIR,
  SOURCE_TRAEFIK_TEMPLATES,
  SOURCE_SKILLS_DIR
} from '../../lib/paths.js';
import { getDefaultConfig, saveConfig } from '../../lib/config.js';

export function registerInstallCommand(program: Command): void {
  program
    .command('install')
    .description('Install Panopticon prerequisites')
    .option('--check', 'Check prerequisites only')
    .option('--minimal', 'Skip Traefik and mkcert (use port-based routing)')
    .option('--skip-mkcert', 'Skip mkcert/HTTPS setup')
    .option('--skip-docker', 'Skip Docker network setup')
    .action(installCommand);
}

interface InstallOptions {
  check?: boolean;
  minimal?: boolean;
  skipMkcert?: boolean;
  skipDocker?: boolean;
}

interface PrereqResult {
  name: string;
  passed: boolean;
  message: string;
  fix?: string;
}

function detectPlatform(): 'linux' | 'darwin' | 'win32' | 'wsl' {
  const os = platform();
  if (os === 'linux') {
    // Check for WSL
    try {
      const release = readFileSync('/proc/version', 'utf8').toLowerCase();
      if (release.includes('microsoft') || release.includes('wsl')) {
        return 'wsl';
      }
    } catch {}
    return 'linux';
  }
  return os as 'darwin' | 'win32';
}

/**
 * Recursively copy directory contents
 */
function copyDirectoryRecursive(source: string, dest: string): void {
  if (!existsSync(source)) {
    throw new Error(`Source directory not found: ${source}`);
  }

  mkdirSync(dest, { recursive: true });

  const entries = readdirSync(source);
  for (const entry of entries) {
    const sourcePath = join(source, entry);
    const destPath = join(dest, entry);
    const stat = statSync(sourcePath);

    if (stat.isDirectory()) {
      copyDirectoryRecursive(sourcePath, destPath);
    } else {
      copyFileSync(sourcePath, destPath);
    }
  }
}

function checkCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkPrerequisites(): { results: PrereqResult[]; allPassed: boolean } {
  const results: PrereqResult[] = [];

  // Node.js
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0]);
  results.push({
    name: 'Node.js',
    passed: nodeMajor >= 18,
    message: nodeMajor >= 18 ? `v${nodeVersion}` : `v${nodeVersion} (need v18+)`,
    fix: 'Install Node.js 18+ from https://nodejs.org',
  });

  // Git
  const hasGit = checkCommand('git');
  results.push({
    name: 'Git',
    passed: hasGit,
    message: hasGit ? 'installed' : 'not found',
    fix: 'Install git from your package manager',
  });

  // Docker
  const hasDocker = checkCommand('docker');
  let dockerRunning = false;
  if (hasDocker) {
    try {
      execSync('docker info', { stdio: 'pipe' });
      dockerRunning = true;
    } catch {}
  }
  results.push({
    name: 'Docker',
    passed: dockerRunning,
    message: dockerRunning ? 'running' : hasDocker ? 'not running' : 'not found',
    fix: hasDocker ? 'Start Docker Desktop or docker service' : 'Install Docker',
  });

  // tmux
  const hasTmux = checkCommand('tmux');
  results.push({
    name: 'tmux',
    passed: hasTmux,
    message: hasTmux ? 'installed' : 'not found',
    fix: 'apt install tmux / brew install tmux',
  });

  // mkcert (optional but recommended)
  const hasMkcert = checkCommand('mkcert');
  results.push({
    name: 'mkcert',
    passed: hasMkcert,
    message: hasMkcert ? 'installed' : 'not found (optional)',
    fix: 'brew install mkcert / apt install mkcert',
  });

  // Beads CLI
  const hasBeads = checkCommand('bd');
  results.push({
    name: 'Beads CLI (bd)',
    passed: hasBeads,
    message: hasBeads ? 'installed' : 'not found',
    fix: 'cargo install beads-cli',
  });

  // ttyd (web terminal for planning sessions)
  const hasTtyd = checkCommand('ttyd') || existsSync(join(homedir(), 'bin', 'ttyd'));
  results.push({
    name: 'ttyd',
    passed: hasTtyd,
    message: hasTtyd ? 'installed' : 'not found',
    fix: 'brew install ttyd / Download from https://github.com/tsl0922/ttyd/releases',
  });

  return {
    results,
    allPassed: results.filter((r) => r.name !== 'mkcert' && r.name !== 'ttyd').every((r) => r.passed),
  };
}

function printPrereqStatus(prereqs: { results: PrereqResult[]; allPassed: boolean }): void {
  console.log(chalk.bold('Prerequisites:\n'));

  for (const result of prereqs.results) {
    const icon = result.passed ? chalk.green('✓') : chalk.red('✗');
    const msg = result.passed ? chalk.dim(result.message) : chalk.yellow(result.message);
    console.log(`  ${icon} ${result.name}: ${msg}`);
    if (!result.passed && result.fix) {
      console.log(`    ${chalk.dim('→ ' + result.fix)}`);
    }
  }
  console.log('');
}

async function installCommand(options: InstallOptions): Promise<void> {
  console.log(chalk.bold('\nPanopticon Installation\n'));

  const plat = detectPlatform();
  console.log(`Platform: ${chalk.cyan(plat)}\n`);

  // Step 1: Check prerequisites
  const prereqs = checkPrerequisites();

  if (options.check) {
    printPrereqStatus(prereqs);
    process.exit(prereqs.allPassed ? 0 : 1);
  }

  printPrereqStatus(prereqs);

  if (!prereqs.allPassed) {
    console.log(chalk.red('Fix prerequisites above before continuing.'));
    console.log(chalk.dim('Tip: Run with --minimal to skip optional components'));
    process.exit(1);
  }

  // Step 2: Initialize directories
  const spinner = ora('Initializing Panopticon directories...').start();
  for (const dir of INIT_DIRS) {
    mkdirSync(dir, { recursive: true });
  }
  spinner.succeed('Directories initialized');

  // Step 2b: Install bundled skills to ~/.panopticon/skills/
  if (existsSync(SOURCE_SKILLS_DIR)) {
    spinner.start('Installing bundled skills...');
    try {
      const skillDirs = readdirSync(SOURCE_SKILLS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      let installed = 0;
      let skipped = 0;

      for (const skillDir of skillDirs) {
        const sourcePath = join(SOURCE_SKILLS_DIR, skillDir.name);
        const destPath = join(SKILLS_DIR, skillDir.name);

        // Only copy if skill doesn't exist (don't overwrite user modifications)
        if (!existsSync(destPath)) {
          copyDirectoryRecursive(sourcePath, destPath);
          installed++;
        } else {
          skipped++;
        }
      }

      if (installed > 0) {
        spinner.succeed(`Installed ${installed} skills${skipped > 0 ? ` (${skipped} already exist)` : ''}`);
      } else {
        spinner.info(`Skills already installed (${skipped} skills)`);
      }
    } catch (error) {
      spinner.warn(`Failed to install bundled skills: ${error}`);
    }
  }

  // Step 3: Docker network
  if (!options.skipDocker) {
    spinner.start('Creating Docker network...');
    try {
      execSync('docker network create panopticon 2>/dev/null || true', { stdio: 'pipe' });
      spinner.succeed('Docker network ready');
    } catch (error) {
      spinner.warn('Docker network setup failed (may already exist)');
    }
  }

  // Step 4: mkcert setup
  if (!options.skipMkcert && !options.minimal) {
    const hasMkcert = checkCommand('mkcert');
    if (hasMkcert) {
      spinner.start('Setting up mkcert CA...');
      try {
        execSync('mkcert -install', { stdio: 'pipe' });
        spinner.succeed('mkcert CA installed');

        // Generate wildcard certificates
        spinner.start('Generating wildcard certificates...');
        const traefikCertFile = join(TRAEFIK_CERTS_DIR, '_wildcard.pan.localhost.pem');
        const traefikKeyFile = join(TRAEFIK_CERTS_DIR, '_wildcard.pan.localhost-key.pem');

        execSync(
          `mkcert -cert-file "${traefikCertFile}" -key-file "${traefikKeyFile}" "*.pan.localhost" "*.localhost" localhost 127.0.0.1 ::1`,
          { stdio: 'pipe' }
        );

        // Also copy to legacy certs directory for backwards compatibility
        const legacyCertFile = join(CERTS_DIR, 'localhost.pem');
        const legacyKeyFile = join(CERTS_DIR, 'localhost-key.pem');
        copyFileSync(traefikCertFile, legacyCertFile);
        copyFileSync(traefikKeyFile, legacyKeyFile);

        spinner.succeed('Wildcard certificates generated (*.pan.localhost, *.localhost)');
      } catch (error) {
        spinner.warn('mkcert setup failed (HTTPS may not work)');
      }
    } else {
      spinner.info('Skipping mkcert (not installed)');
    }
  }

  // Step 5: Install ttyd (web terminal for planning sessions)
  const hasTtyd = checkCommand('ttyd') || existsSync(join(homedir(), 'bin', 'ttyd'));
  if (!hasTtyd) {
    spinner.start('Installing ttyd (web terminal)...');
    try {
      const binDir = join(homedir(), 'bin');
      mkdirSync(binDir, { recursive: true });
      const ttydPath = join(binDir, 'ttyd');

      // Determine platform and download appropriate binary
      const plat = detectPlatform();
      let downloadUrl = '';
      if (plat === 'darwin') {
        // macOS - try homebrew first
        try {
          execSync('brew install ttyd', { stdio: 'pipe' });
          spinner.succeed('ttyd installed via Homebrew');
        } catch {
          spinner.warn('ttyd installation failed - install manually: brew install ttyd');
        }
      } else {
        // Linux/WSL - download binary
        downloadUrl = 'https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.x86_64';
        try {
          execSync(`curl -sL "${downloadUrl}" -o "${ttydPath}" && chmod +x "${ttydPath}"`, {
            stdio: 'pipe',
            timeout: 60000,
          });
          spinner.succeed(`ttyd installed to ${ttydPath}`);
        } catch (error) {
          spinner.warn('ttyd download failed - install manually from https://github.com/tsl0922/ttyd/releases');
        }
      }
    } catch (error) {
      spinner.warn('ttyd installation failed (planning sessions will not work)');
    }
  } else {
    spinner.info('ttyd already installed');
  }

  // Step 6: Setup Traefik configuration
  if (!options.minimal) {
    spinner.start('Setting up Traefik configuration...');

    try {
      // Copy Traefik templates from package to ~/.panopticon/traefik/
      // Only copy if files don't already exist
      if (!existsSync(join(TRAEFIK_DIR, 'docker-compose.yml'))) {
        copyDirectoryRecursive(SOURCE_TRAEFIK_TEMPLATES, TRAEFIK_DIR);
        spinner.succeed('Traefik configuration created from templates');
      } else {
        spinner.info('Traefik configuration already exists (skipping)');
      }

      // Check if existing docker-compose.yml needs migration (for upgrades)
      const existingCompose = join(TRAEFIK_DIR, 'docker-compose.yml');
      if (existsSync(existingCompose)) {
        const content = readFileSync(existingCompose, 'utf-8');
        if (content.includes('panopticon:') && !content.includes('external: true')) {
          // Patch the file to add external: true
          const patched = content.replace(
            /networks:\s*\n\s*panopticon:\s*\n\s*name: panopticon\s*\n\s*driver: bridge/,
            'networks:\n  panopticon:\n    name: panopticon\n    external: true  # Network created by \'pan install\''
          );
          writeFileSync(existingCompose, patched);
          spinner.info('Migrated Traefik config (added external: true to network)');
        }
      }
    } catch (error) {
      spinner.fail(`Failed to set up Traefik configuration: ${error}`);
      console.log(chalk.yellow('You can set up Traefik manually later'));
    }
  }

  // Step 6: Create config file if doesn't exist
  const configFile = join(PANOPTICON_HOME, 'config.toml');
  if (!existsSync(configFile)) {
    spinner.start('Creating default config...');

    // Get default config and customize based on install options
    const config = getDefaultConfig();

    // Configure Traefik based on minimal flag
    if (options.minimal) {
      config.traefik = {
        enabled: false,
      };
    } else {
      config.traefik = {
        enabled: true,
        dashboard_port: 8080,
        domain: 'pan.localhost',
      };
    }

    saveConfig(config);
    spinner.succeed('Config created');
  }

  // Done!
  console.log('');
  console.log(chalk.green.bold('Installation complete!'));
  console.log('');
  console.log(chalk.bold('Next steps:'));
  console.log(`  1. Run ${chalk.cyan('pan sync')} to sync skills to ~/.claude/`);

  if (!options.minimal) {
    console.log(`  2. Add to ${chalk.yellow('/etc/hosts')}: ${chalk.cyan('127.0.0.1 pan.localhost')}`);
    console.log(`  3. Run ${chalk.cyan('pan up')} to start Traefik and dashboard`);
    console.log(`  4. Access dashboard at ${chalk.cyan('https://pan.localhost')}`);
  } else {
    console.log(`  2. Run ${chalk.cyan('pan up')} to start the dashboard`);
    console.log(`  3. Access dashboard at ${chalk.cyan('http://localhost:3001')}`);
  }

  console.log(`  ${!options.minimal ? '5' : '4'}. Create a workspace with ${chalk.cyan('pan workspace create <issue-id>')}`);
  console.log('');
}
