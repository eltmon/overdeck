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
const BIN_DIR = join(homedir(), '.panopticon', 'bin');
const SCRIPTS_DIR = __dirname;

// Only run if Panopticon has been initialized
if (!existsSync(join(homedir(), '.panopticon'))) {
  console.log('Panopticon not initialized yet. Run `pan init` to set up.');
  process.exit(0);
}

// Ensure bin directory exists
mkdirSync(BIN_DIR, { recursive: true });

// Copy all scripts from scripts/ to ~/.panopticon/bin/
const scripts = readdirSync(SCRIPTS_DIR)
  .filter(f => !f.startsWith('.') && !f.endsWith('.mjs') && !f.endsWith('.js'));

let synced = 0;
for (const script of scripts) {
  try {
    const source = join(SCRIPTS_DIR, script);
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

// Suggest running full sync
console.log('Run `pan sync` to sync skills and commands to AI tools.');
