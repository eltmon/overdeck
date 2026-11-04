#!/usr/bin/env node
// Runs the frontend vitest subset named in a list file instead of a single
// giant package.json script line, so parallel PRs adding frontend tests no
// longer conflict on one shared line (PAN-4697).
//
//   node scripts/run-frontend-test-subset.mjs [--list <path>] [--dry-run] [-- ...extra]

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
let listPath = resolve(repoRoot, 'scripts', 'frontend-test-subset.txt');
let dryRun = false;
const extra = [];

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--list') {
    listPath = resolve(process.cwd(), argv[++i]);
  } else if (arg === '--dry-run') {
    dryRun = true;
  } else {
    extra.push(arg);
  }
}

if (!existsSync(listPath)) {
  console.error(`run-frontend-test-subset: ${listPath} not found`);
  process.exit(1);
}

const seen = new Set();
const paths = [];
for (const rawLine of readFileSync(listPath, 'utf-8').split('\n')) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#') || seen.has(line)) continue;
  seen.add(line);
  paths.push(line);
}

if (paths.length === 0) {
  console.error(`run-frontend-test-subset: ${listPath} lists no test files`);
  process.exit(1);
}

const args = ['--prefix', './src/dashboard/frontend', 'run', 'test', '--', ...paths, ...extra];

if (dryRun) {
  console.log(JSON.stringify({ command: 'npm', args }));
  process.exit(0);
}

const result = spawnSync('npm', args, { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
