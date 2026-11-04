/**
 * pan update - Update Overdeck to latest version
 */

import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isRuntimePackageRoot } from '../../lib/anywhere/connect-runtime.js';
import { loadConfigSync } from '../../lib/config.js';
import { getOverdeckHome, packageRoot } from '../../lib/paths.js';
import { syncCommand } from './sync.js';
import { installOverdeckPackage, UpdateManager } from '../../lib/update-manager.js';

// Get current installed version
function getCurrentVersion(): string {
  try {
    const pkgPath = join(packageRoot, 'package.json');
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
    manager = new UpdateManager({ currentVersion, installMode: 'npm-global' });
    const snapshot = await manager.check();
    if (snapshot.phase === 'error' || !snapshot.targetVersion) throw new Error(snapshot.error ?? 'No published version found');
    latestVersion = snapshot.targetVersion;
    console.log(`Latest version:  ${chalk.cyan(latestVersion)}`);
  } catch (error) {
    console.error(chalk.red('Failed to check for updates'));
    console.error(chalk.dim('Make sure you have internet connectivity'));
    return exitCli(1);
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

  const runtimeHome = isRuntimePackageRoot(packageRoot, getOverdeckHome()) ? getOverdeckHome() : null;

  try {
    await installOverdeckPackage(latestVersion, runtimeHome);

    console.log(chalk.green(`\n✓ Updated to ${latestVersion}`));
    console.log(chalk.dim('Installed package: @overdeck/core'));
    console.log(chalk.dim('If you previously installed overdeck or @eltmon/panctl, npm now resolves to the renamed package.'));

    // Auto-sync if enabled
    const config = loadConfigSync();
    if (config.sync.auto_sync) {
      console.log(chalk.dim('\nRunning auto-sync...'));
      await syncCommand({});
    }

    if (runtimeHome) {
      console.log(chalk.dim(`\nRestart the dashboard to run it: ${join(runtimeHome, 'runtime', 'node_modules', '.bin', 'pan')} restart --dashboard --now`));
    } else {
      console.log(chalk.dim('\nRestart any running agents to use the new version.'));
    }
  } catch (error) {
    console.error(chalk.red('\nUpdate failed'));
    if (runtimeHome) {
      console.error(
        chalk.dim(`Install it yourself: npm install --prefix ${join(runtimeHome, 'runtime')} @overdeck/core@latest`)
      );
    } else {
      console.error(
        chalk.dim('Try running with sudo: sudo npm install -g @overdeck/core@latest')
      );
      console.error(
        chalk.dim('If you were on overdeck or @eltmon/panctl, rerun the install command above to migrate to @overdeck/core.')
      );
    }
    return exitCli(1);
  }
}
