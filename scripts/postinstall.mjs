#!/usr/bin/env node
/**
 * Postinstall script for Overdeck
 *
 * Automatically syncs hooks after npm install/upgrade if Overdeck
 * has been initialized (bin dir exists).
 */

import { existsSync, readdirSync, copyFileSync, chmodSync, mkdirSync, accessSync, constants } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(__dirname);
const BIN_DIR = join(homedir(), '.overdeck', 'bin');
// PAN-1201: hook scripts live under sync-sources/hooks/, not scripts/.
const HOOKS_SOURCE_DIR = join(PACKAGE_ROOT, 'sync-sources', 'hooks');

// PAN-2630: a source checkout (one with src/ — npm packages never ship it)
// has no npm-managed bin link for `pan`, unlike an `npm install -g` install.
// Hint the fix once, up front, rather than leaving the operator to discover
// `pan: command not found` on their own.
function hintMissingPan() {
  if (!existsSync(join(PACKAGE_ROOT, 'src'))) return;

  const pathEnv = process.env.PATH ?? '';
  const onPath = pathEnv.split(':').some(segment => {
    if (!segment) return false;
    try {
      const candidate = join(segment, 'pan');
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (onPath) return;

  console.log(
    'Overdeck: pan is not on your PATH. After npm run build, run npm link in this checkout, ' +
    'or add ~/.overdeck/cli-bin to PATH after pan install. Until then: node dist/cli/index.js doctor',
  );
}

function syncHooksIfInitialized() {
  if (!existsSync(join(homedir(), '.overdeck'))) {
    console.log('Overdeck not initialized yet. Run `pan init` to set up.');
    return;
  }

  // Ensure bin directory exists
  mkdirSync(BIN_DIR, { recursive: true });

  // Copy hook scripts (extensionless executables + .sh helpers) to
  // ~/.overdeck/bin/. Built artifacts (record-cost-event.js), build config
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
    console.log(`✓ Synced ${synced} hooks to ~/.overdeck/bin/`);
  }
}

hintMissingPan();
syncHooksIfInitialized();

// Suggest running full sync
console.log('Run `pan sync` to sync skills and commands to AI tools.');
