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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(__dirname);
const BIN_DIR = join(homedir(), '.panopticon', 'bin');
// PAN-1201: hook scripts live under sync-sources/hooks/, not scripts/.
const HOOKS_SOURCE_DIR = join(PACKAGE_ROOT, 'sync-sources', 'hooks');

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

syncHooksIfInitialized();

// Suggest running full sync
console.log('Run `pan sync` to sync skills and commands to AI tools.');
