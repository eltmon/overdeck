/**
 * scripts/migrate-continue-files-to-pan.mjs
 *
 * One-shot migration script for PAN-967 phase 2: moves project-side continue
 * files from legacy `vbrief/{proposed,active,completed,cancelled}/continue-<ISSUE>.vbrief.json`
 * to the canonical `<projectRoot>/.pan/continues/<issue-lowercase>.vbrief.json`.
 *
 * Idempotent: skips files where the destination already exists (no overwrite).
 * Logs each move (from → to) and a summary at the end.
 * Run once from the repo root: node scripts/migrate-continue-files-to-pan.mjs
 */

import { existsSync, mkdirSync, readdirSync, renameSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = process.cwd();
const continuesDir = join(projectRoot, '.pan', 'continues');
const legacyLifecycles = ['proposed', 'active', 'completed', 'cancelled'];

const CONTINUE_PREFIX = 'continue-';
const CONTINUE_SUFFIX = '.vbrief.json';

let moved = 0;
let skipped = 0;
let errors = 0;

function log(msg) {
  console.log(`  ${msg}`);
}

function parseIssueId(filename) {
  // Filename format: continue-<ISSUE>.vbrief.json
  // e.g. continue-PAN-1014.vbrief.json
  if (!filename.startsWith(CONTINUE_PREFIX) || !filename.endsWith(CONTINUE_SUFFIX)) {
    return null;
  }
  const issueWithSuffix = filename.slice(CONTINUE_PREFIX.length);
  const issueId = issueWithSuffix.slice(0, -CONTINUE_SUFFIX.length);
  return issueId;
}

function ensureContinuesDir() {
  if (!existsSync(continuesDir)) {
    mkdirSync(continuesDir, { recursive: true });
    log(`Created .pan/continues/`);
  }
}

function migrateFile(srcPath) {
  const filename = basename(srcPath);
  const issueId = parseIssueId(filename);
  if (!issueId) {
    log(`SKIP (unrecognized format): ${filename}`);
    skipped++;
    return;
  }

  const destFilename = `${issueId.toLowerCase()}.vbrief.json`;
  const destPath = join(continuesDir, destFilename);

  if (existsSync(destPath)) {
    log(`SKIP (exists): ${filename} → ${destFilename} (already migrated)`);
    skipped++;
    return;
  }

  try {
    renameSync(srcPath, destPath);
    log(`MOVED: ${filename} → ${destFilename}`);
    moved++;
  } catch (err) {
    console.error(`  ERROR moving ${filename}: ${err.message}`);
    errors++;
  }
}

ensureContinuesDir();

console.log(`\nMigrating continue files from vbrief/*/ to .pan/continues/`);
console.log(`Project root: ${projectRoot}\n`);

for (const lifecycle of legacyLifecycles) {
  const lifecycleDir = join(projectRoot, 'vbrief', lifecycle);
  if (!existsSync(lifecycleDir)) continue;

  let files;
  try {
    files = readdirSync(lifecycleDir);
  } catch {
    continue;
  }

  for (const filename of files) {
    if (!filename.startsWith(CONTINUE_PREFIX) || !filename.endsWith(CONTINUE_SUFFIX)) {
      continue;
    }
    migrateFile(join(lifecycleDir, filename));
  }
}

console.log(`\n--- Summary ---`);
console.log(`Moved:  ${moved}`);
console.log(`Skipped: ${skipped}`);
console.log(`Errors:  ${errors}`);

if (errors > 0) {
  process.exit(1);
}
