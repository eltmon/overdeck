#!/usr/bin/env node
/**
 * Postinstall script for Panopticon
 *
 * Automatically syncs hooks after npm install/upgrade if Panopticon
 * has been initialized (bin dir exists).
 */

import { existsSync, readdirSync, copyFileSync, chmodSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(__dirname);
const BIN_DIR = join(homedir(), '.panopticon', 'bin');
// PAN-1201: hook scripts live under sync-sources/hooks/, not scripts/.
const HOOKS_SOURCE_DIR = join(PACKAGE_ROOT, 'sync-sources', 'hooks');
const NATIVE_MODULES = ['better-sqlite3'];

function syncHooksIfInitialized() {
  if (!existsSync(join(homedir(), '.panopticon'))) {
    console.log('Panopticon not initialized yet. Run `pan init` to set up.');
    return;
  }

  // Ensure bin directory exists
  mkdirSync(BIN_DIR, { recursive: true });

  // Copy hook scripts (extensionless executables + .sh helpers) to
  // ~/.panopticon/bin/. Built artifacts (record-cost-event.js), build config
  // (tsdown.config.ts, *.ts), and the git-hooks/ subdir are skipped — those
  // are not Claude Code hooks. `pan sync` handles record-cost-event.js.
  if (!existsSync(HOOKS_SOURCE_DIR)) return;
  const scripts = readdirSync(HOOKS_SOURCE_DIR, { withFileTypes: true })
    .filter(d => d.isFile() && !d.name.startsWith('.'))
    .filter(d => !d.name.includes('.') || d.name.endsWith('.sh'))
    .map(d => d.name);

  let synced = 0;
  for (const script of scripts) {
    try {
      const source = join(HOOKS_SOURCE_DIR, script);
      const target = join(BIN_DIR, script);
      copyFileSync(source, target);
      chmodSync(target, 0o755);
      synced++;
    } catch (e) {
      // Ignore errors, hooks are non-critical
    }
  }

  if (synced > 0) {
    console.log(`✓ Synced ${synced} hooks to ~/.panopticon/bin/`);
  }
}

function rebuildNativeModules() {
  if (process.env.PANOPTICON_SKIP_NATIVE_POSTINSTALL === '1') {
    return;
  }

  const npmExecPath = process.env.npm_execpath;
  const userAgent = process.env.npm_config_user_agent || '';
  const packageManager = userAgent.startsWith('bun/') ? 'bun' : 'npm';

  if (!npmExecPath && packageManager === 'npm') {
    console.warn('! Skipping native module rebuild: npm_execpath is unavailable.');
    return;
  }

  const command = packageManager === 'bun'
    ? 'bun'
    : process.execPath;
  const args = packageManager === 'bun'
    ? ['rebuild', ...NATIVE_MODULES]
    : [npmExecPath, 'rebuild', ...NATIVE_MODULES];

  const result = spawnSync(command, args, {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    const managerLabel = packageManager === 'bun' ? 'bun rebuild' : 'npm rebuild';
    console.warn(`! Native module rebuild failed. Run \
\`${managerLabel} ${NATIVE_MODULES.join(' ')}\` manually if Panopticon cannot start.`);
  }
}

syncHooksIfInitialized();
rebuildNativeModules();

// Suggest running full sync
console.log('Run `pan sync` to sync skills and commands to AI tools.');
