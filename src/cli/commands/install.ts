import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
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
import { getDefaultConfig, saveConfig, loadConfig } from '../../lib/config.js';
import { detectPlatform } from '../../lib/platform.js';
import { detectDnsSyncMethod, ensureBaseDomain, syncDnsToWindows } from '../../lib/dns.js';
import { generatePanopticonTraefikConfig, cleanupTemplateFiles, ensureProjectCerts, generateTlsConfig } from '../../lib/traefik.js';
import { refreshCache } from '../../lib/sync.js';
import { setupHooksCommand } from './setup/hooks.js';

export function registerInstallCommand(program: Command): void {
  program
    .command('install')
    .description('Install Panopticon prerequisites')
    .option('--check', 'Check prerequisites only')
    .option('--minimal', 'Skip Traefik and mkcert (use port-based routing)')
    .option('--skip-mkcert', 'Skip mkcert/HTTPS setup')
    .option('--skip-docker', 'Skip Docker network setup')
    .option('--skip-beads', 'Skip beads CLI installation')
    .action(installCommand);
}

interface InstallOptions {
  check?: boolean;
  minimal?: boolean;
  skipMkcert?: boolean;
  skipDocker?: boolean;
  skipBeads?: boolean;
}

interface PrereqResult {
  name: string;
  passed: boolean;
  message: string;
  fix?: string;
}

// detectPlatform() is now in src/lib/platform.ts

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

  // mkcert (optional but recommended - will be auto-installed)
  const hasMkcert = checkCommand('mkcert');
  results.push({
    name: 'mkcert',
    passed: hasMkcert,
    message: hasMkcert ? 'installed' : 'not found (will auto-install)',
    fix: 'Download from https://github.com/FiloSottile/mkcert/releases',
  });

  // Beads CLI (optional - will be auto-installed)
  const hasBeads = checkCommand('bd');
  let beadsVersion = '';
  if (hasBeads) {
    try {
      const output = execSync('bd --version', { encoding: 'utf-8' }).trim();
      const match = output.match(/(\d+\.\d+\.\d+)/);
      beadsVersion = match ? match[1] : 'unknown';
    } catch {}
  }
  results.push({
    name: 'Beads CLI (bd)',
    passed: hasBeads,
    message: hasBeads ? `v${beadsVersion}` : 'not found (will auto-install)',
    fix: 'curl -sSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash',
  });

  // jq (JSON processor — used by statusline, beads, merge-agent, review-agent, dashboard)
  const hasJq = checkCommand('jq');
  results.push({
    name: 'jq',
    passed: hasJq,
    message: hasJq ? 'installed' : 'not found',
    fix: 'apt install jq / brew install jq',
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
    // mkcert, ttyd, and beads are optional (will be auto-installed or skipped)
    allPassed: results.filter((r) => r.name !== 'mkcert' && r.name !== 'ttyd' && r.name !== 'Beads CLI (bd)').every((r) => r.passed),
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

  // Step 2b: Refresh cache — copy all skills/agents/rules from repo to ~/.panopticon/
  spinner.start('Refreshing skill cache...');
  try {
    const cacheResult = refreshCache();
    const parts = [];
    if (cacheResult.skills.copied > 0) parts.push(`${cacheResult.skills.copied} skills`);
    if (cacheResult.agents.copied > 0) parts.push(`${cacheResult.agents.copied} agents`);
    if (cacheResult.rules.copied > 0) parts.push(`${cacheResult.rules.copied} rules`);
    spinner.succeed(`Cache refreshed: ${parts.length > 0 ? parts.join(', ') : 'up to date'}`);
  } catch (error) {
    spinner.warn(`Failed to refresh cache: ${error}`);
  }

  await setupHooksCommand();

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

  // Step 4: mkcert setup (auto-install if missing)
  if (!options.skipMkcert && !options.minimal) {
    let hasMkcert = checkCommand('mkcert');
    if (!hasMkcert) {
      spinner.start('Installing mkcert...');
      try {
        const plat = detectPlatform();
        if (plat === 'darwin') {
          execSync('brew install mkcert', { stdio: 'pipe', timeout: 120000 });
          spinner.succeed('mkcert installed via Homebrew');
        } else {
          const binDir = join(homedir(), '.local', 'bin');
          mkdirSync(binDir, { recursive: true });
          const mkcertPath = join(binDir, 'mkcert');
          const arch = process.arch === 'x64' ? 'amd64' : process.arch;
          execSync(`curl -sL "https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-${arch}" -o "${mkcertPath}" && chmod +x "${mkcertPath}"`, {
            stdio: 'pipe',
            timeout: 60000,
          });
          spinner.succeed(`mkcert installed to ${mkcertPath}`);
        }
        hasMkcert = checkCommand('mkcert');
      } catch {
        spinner.warn('mkcert auto-install failed - install manually from https://github.com/FiloSottile/mkcert/releases');
      }
    }
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
          `mkcert -cert-file "${traefikCertFile}" -key-file "${traefikKeyFile}" "pan.localhost" "*.pan.localhost" "*.localhost" localhost 127.0.0.1 ::1`,
          { stdio: 'pipe' }
        );

        // Also copy to legacy certs directory for backwards compatibility
        const legacyCertFile = join(CERTS_DIR, 'localhost.pem');
        const legacyKeyFile = join(CERTS_DIR, 'localhost-key.pem');
        copyFileSync(traefikCertFile, legacyCertFile);
        copyFileSync(traefikKeyFile, legacyKeyFile);

        spinner.succeed('Wildcard certificates generated (*.pan.localhost, *.localhost)');

        // Generate certs for registered projects and build tls.yml
        const generatedDomains = ensureProjectCerts();
        for (const domain of generatedDomains) {
          spinner.succeed(`Generated wildcard cert for *.${domain}`);
        }
        if (generateTlsConfig()) {
          spinner.succeed('TLS config generated (tls.yml)');
        }
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

  // Step 5b: Install beads CLI (git-backed issue tracker)
  if (options.skipBeads) {
    spinner.info('Skipping beads installation (--skip-beads)');
  } else {
    const hasBeadsNow = checkCommand('bd');
    if (!hasBeadsNow) {
    spinner.start('Installing beads CLI (bd)...');
    try {
      const plat = detectPlatform();
      if (plat === 'darwin') {
        // macOS - try homebrew
        try {
          execSync('brew install gastownhall/beads/bd', { stdio: 'pipe', timeout: 120000 });
          spinner.succeed('beads installed via Homebrew');
        } catch {
          // Fall back to curl script
          try {
            execSync('curl -sSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash', {
              stdio: 'pipe',
              timeout: 120000,
            });
            spinner.succeed('beads installed via install script');
          } catch {
            spinner.warn('beads installation failed - install manually: brew install gastownhall/beads/bd');
          }
        }
      } else {
        // Linux/WSL - use install script
        try {
          execSync('curl -sSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash', {
            stdio: 'pipe',
            timeout: 120000,
          });
          spinner.succeed('beads installed via install script');
        } catch (error) {
          spinner.warn('beads installation failed - install manually: curl -sSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash');
        }
      }
    } catch (error) {
      spinner.warn('beads installation failed (workspace beads tracking will not work)');
    }
  } else {
    // Check if upgrade is needed
    try {
      const output = execSync('bd --version', { encoding: 'utf-8' }).trim();
      const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
      if (match) {
        const [, major, minor, patch] = match.map(Number);
        const currentVersion = major * 10000 + minor * 100 + patch;
        const recommendedVersion = 1 * 10000 + 0 * 100 + 4; // v1.0.4 required for bd ping, auto-repair, perms-fix
        if (currentVersion < recommendedVersion) {
          spinner.info(`beads v${major}.${minor}.${patch} installed (v1.0.4+ recommended for new features)`);
        } else {
          spinner.info(`beads v${major}.${minor}.${patch} installed`);
        }
      } else {
        spinner.info('beads already installed');
      }
    } catch {
      spinner.info('beads already installed');
    }
    }
  }

  // Step 6: Setup Traefik configuration
  if (!options.minimal) {
    spinner.start('Setting up Traefik configuration...');

    try {
      // Copy static Traefik files (docker-compose.yml, traefik.yml, certs)
      // Only copy if files don't already exist
      if (!existsSync(join(TRAEFIK_DIR, 'docker-compose.yml'))) {
        copyDirectoryRecursive(SOURCE_TRAEFIK_TEMPLATES, TRAEFIK_DIR);
        // Remove .template files from runtime dir (they stay in source only)
        cleanupTemplateFiles();
        spinner.succeed('Traefik configuration created from templates');
      } else {
        spinner.info('Traefik static config already exists (skipping)');
      }

      // Always regenerate panopticon.yml from template to pick up config changes
      if (generatePanopticonTraefikConfig()) {
        spinner.succeed('Traefik dynamic config generated (panopticon.yml)');
      }

      // Always regenerate tls.yml from discovered certs
      if (generateTlsConfig()) {
        spinner.succeed('TLS config generated (tls.yml)');
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

  // Step 7: Create or update config file
  const configFile = join(PANOPTICON_HOME, 'config.toml');
  const configExists = existsSync(configFile);

  if (!configExists) {
    spinner.start('Creating default config...');
  } else {
    spinner.start('Updating config with new settings...');
  }

  // Load existing config (or defaults if none exists)
  const config = configExists ? loadConfig() : getDefaultConfig();

  // Configure Traefik based on minimal flag (always update this section)
  if (options.minimal) {
    config.traefik = {
      enabled: false,
    };
  } else {
    const dnsMethod = config.traefik?.dns_sync_method || detectDnsSyncMethod();
    // Only set traefik config if not already configured, or if it was disabled
    if (!config.traefik || !config.traefik.enabled) {
      config.traefik = {
        enabled: true,
        dashboard_port: 8080,
        domain: 'pan.localhost',
        dns_sync_method: dnsMethod,
      };
    } else if (!config.traefik.dns_sync_method) {
      // Backfill dns_sync_method on existing installs
      config.traefik.dns_sync_method = dnsMethod;
    }
  }

  // Step 7b: Shadow mode configuration
  spinner.stop();
  console.log('');
  console.log(chalk.bold('Shadow Mode Configuration'));
  console.log(chalk.dim('Shadow mode tracks issue status locally without modifying the tracker.'));
  console.log('');

  const { shadowModeChoice } = await inquirer.prompt([{
    type: 'list',
    name: 'shadowModeChoice',
    message: 'How should Panopticon interact with issue trackers?',
    choices: [
      { name: 'Normal - Update issue status in tracker (default)', value: 'normal' },
      { name: 'Shadow - Track status locally, don\'t modify tracker', value: 'shadow' },
      { name: 'Ask per-project - Configure each project separately', value: 'ask' },
    ],
    default: 'normal',
  }]);

  if (shadowModeChoice === 'shadow') {
    config.shadow.enabled = true;
    console.log(chalk.cyan('👻 Shadow mode enabled globally'));
  } else if (shadowModeChoice === 'normal') {
    config.shadow.enabled = false;
  }
  // For 'ask', we leave the default (false) and let projects configure it

  // Per-tracker shadow configuration
  if (shadowModeChoice !== 'shadow') {
    console.log('');
    const { configurePerTracker } = await inquirer.prompt([{
      type: 'confirm',
      name: 'configurePerTracker',
      message: 'Configure shadow mode per tracker?',
      default: false,
    }]);

    if (configurePerTracker) {
      const trackers = ['linear', 'github', 'gitlab', 'rally'];
      for (const tracker of trackers) {
        const { enableShadow } = await inquirer.prompt([{
          type: 'confirm',
          name: 'enableShadow',
          message: `Enable shadow mode for ${tracker}?`,
          default: false,
        }]);
        config.shadow.trackers[tracker as keyof typeof config.shadow.trackers] = enableShadow;
      }
    }
  }

  spinner.start('Saving configuration...');
  saveConfig(config);
  spinner.succeed(configExists ? 'Config updated' : 'Config created');

  // Regenerate Traefik dynamic config now that config is saved
  if (config.traefik?.enabled) {
    generatePanopticonTraefikConfig();
  }

  // Ensure base domain DNS entry
  if (config.traefik?.enabled) {
    const domain = config.traefik.domain || 'pan.localhost';
    const dnsMethod = config.traefik.dns_sync_method || detectDnsSyncMethod();
    spinner.start(`Setting up DNS for ${domain}...`);
    if (ensureBaseDomain(dnsMethod, domain)) {
      // If using wsl2hosts, also trigger a sync to Windows
      if (dnsMethod === 'wsl2hosts') {
        await syncDnsToWindows();
      }
      spinner.succeed(`DNS entry added: ${domain} (method: ${dnsMethod})`);
    } else {
      spinner.warn(`Could not add DNS entry for ${domain}. You may need to add it manually.`);
    }
  }

  // Done!
  console.log('');
  console.log(chalk.green.bold('Installation complete!'));
  console.log('');
  console.log(chalk.bold('Next steps:'));

  if (!options.minimal) {
    console.log(`  1. Run ${chalk.cyan('pan up')} to start Traefik and dashboard (auto-syncs skills)`);
    console.log(`  2. Access dashboard at ${chalk.cyan(`https://${config.traefik?.domain || 'pan.localhost'}`)}`);
  } else {
    console.log(`  1. Run ${chalk.cyan('pan up')} to start the dashboard (auto-syncs skills)`);
    console.log(`  2. Access dashboard at ${chalk.cyan(`http://localhost:${config.dashboard.port}`)}`);
  }

  console.log(`  4. In each project root, initialize beads task tracking:`);
  console.log(`     ${chalk.cyan('cd /path/to/your-project && bd init --prefix <project-name>')}`);
  console.log(`     ${chalk.dim('e.g. bd init --prefix panopticon  (enables agent task tracking for this project)')}`);
  console.log(`  5. Create a workspace with ${chalk.cyan('pan workspace create <issue-id>')}`);
  console.log('');
}
