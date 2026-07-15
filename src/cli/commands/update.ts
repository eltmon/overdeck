/**
 * pan update - Update Overdeck to latest version
 */

import chalk from 'chalk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { UpdateManager } from '../../lib/update-manager.js';

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

export async function updateCommand(options: {
  check?: boolean;
  force?: boolean;
}) {
  console.log(chalk.bold('Overdeck Update\n'));

  const currentVersion = getCurrentVersion();
  console.log(`Current version: ${chalk.cyan(currentVersion)}`);

  let manager: UpdateManager;
  let latestVersion: string;
  try {
    console.log(chalk.dim('Checking npm for latest version...'));
    manager = new UpdateManager({ currentVersion, installMode: 'npm' });
    const snapshot = await manager.check({ forceRefresh: true });
    if (snapshot.phase === 'error' || !snapshot.targetVersion) throw new Error(snapshot.error?.message ?? 'No published version found');
    latestVersion = snapshot.targetVersion;
    console.log(`Latest version:  ${chalk.cyan(latestVersion)}`);
  } catch (error) {
    console.error(chalk.red('Failed to check for updates'));
    console.error(chalk.dim('Make sure you have internet connectivity'));
    process.exit(1);
  }

  const needsUpdate = manager!.getSnapshot().phase === 'available';

  if (!needsUpdate && !options.force) {
    console.log(chalk.green('\n✓ You are on the latest version'));
    return;
  }

  console.log(
    chalk.yellow(`\n↑ Update available: ${currentVersion} → ${latestVersion}`)
  );

  if (options.check) {
    console.log(chalk.dim('\nRun `pan update` to install @overdeck/core.'));
    console.log(chalk.dim('If you previously installed overdeck or @eltmon/panctl, this migrates you to the new package name.'));
    return;
  }

  // Perform the update
  console.log(chalk.dim('\nUpdating Overdeck...'));

  try {
    manager.install({ force: options.force });
    const result = await manager.waitForInstall();
    if (result.phase === 'error') throw new Error(result.error?.message ?? 'Update failed');

    console.log(chalk.green(`\n✓ Updated to ${latestVersion}`));
    console.log(chalk.dim('Installed package: @overdeck/core'));
    console.log(chalk.dim('If you previously installed overdeck or @eltmon/panctl, npm now resolves to the renamed package.'));

    console.log(chalk.dim('\nRestart any running agents to use the new version.'));
  } catch (error) {
    console.error(chalk.red('\nUpdate failed'));
    console.error(
      chalk.dim(`Try running with sudo: sudo npm install -g @overdeck/core@${latestVersion}`)
    );
    console.error(
      chalk.dim('If you were on overdeck or @eltmon/panctl, rerun the install command above to migrate to @overdeck/core.')
    );
    process.exit(1);
  }
}
