/**
 * pan update - Update Panopticon to latest version
 */

import { execSync } from 'child_process';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadConfig } from '../../lib/config.js';
import { syncCommand } from './sync.js';

// Get current installed version
function getCurrentVersion(): string {
  try {
    // Navigate from this file to package.json
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkgPath = join(__dirname, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

// Get latest version from npm
async function getLatestVersion(): Promise<string> {
  try {
    const result = execSync('npm view panopticon-cli version', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    throw new Error('Failed to check npm for latest version');
  }
}

// Compare semver versions
function isNewer(latest: string, current: string): boolean {
  const parseVersion = (v: string) => {
    const parts = v.replace(/^v/, '').split('.');
    return {
      major: parseInt(parts[0] || '0', 10),
      minor: parseInt(parts[1] || '0', 10),
      patch: parseInt(parts[2] || '0', 10),
    };
  };

  const l = parseVersion(latest);
  const c = parseVersion(current);

  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  return l.patch > c.patch;
}

export async function updateCommand(options: {
  check?: boolean;
  force?: boolean;
}) {
  console.log(chalk.bold('Panopticon Update\n'));

  const currentVersion = getCurrentVersion();
  console.log(`Current version: ${chalk.cyan(currentVersion)}`);

  let latestVersion: string;
  try {
    console.log(chalk.dim('Checking npm for latest version...'));
    latestVersion = await getLatestVersion();
    console.log(`Latest version:  ${chalk.cyan(latestVersion)}`);
  } catch (error) {
    console.error(chalk.red('Failed to check for updates'));
    console.error(chalk.dim('Make sure you have internet connectivity'));
    process.exit(1);
  }

  const needsUpdate = isNewer(latestVersion, currentVersion);

  if (!needsUpdate) {
    console.log(chalk.green('\n✓ You are on the latest version'));
    return;
  }

  console.log(
    chalk.yellow(`\n↑ Update available: ${currentVersion} → ${latestVersion}`)
  );

  if (options.check) {
    console.log(chalk.dim('\nRun `pan update` to install'));
    return;
  }

  // Perform the update
  console.log(chalk.dim('\nUpdating Panopticon...'));

  try {
    execSync('npm install -g panopticon-cli@latest', {
      stdio: 'inherit',
    });

    console.log(chalk.green(`\n✓ Updated to ${latestVersion}`));

    // Auto-sync if enabled
    const config = loadConfig();
    if (config.sync.auto_sync) {
      console.log(chalk.dim('\nRunning auto-sync...'));
      await syncCommand({});
    }

    console.log(chalk.dim('\nRestart any running agents to use the new version.'));
  } catch (error) {
    console.error(chalk.red('\nUpdate failed'));
    console.error(
      chalk.dim('Try running with sudo: sudo npm install -g panopticon-cli@latest')
    );
    process.exit(1);
  }
}
