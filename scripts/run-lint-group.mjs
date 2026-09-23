#!/usr/bin/env node
// Run one group of the `lint` script's steps, so CI can run the groups as
// parallel jobs. The steps come from package.json's `lint` script itself: a
// step not named in HEAVY_STEPS lands in `core`, so a newly added lint step
// can never silently drop out of CI.
//
//   node scripts/run-lint-group.mjs <core|effect|skills|state>
//   node scripts/run-lint-group.mjs --list

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEAVY_STEPS = {
  'npm run lint:effect-diagnostics': 'effect',
  'npm run lint:skills': 'skills',
  'npm run lint:no-state-layer': 'state',
};
const GROUPS = ['core', ...new Set(Object.values(HEAVY_STEPS))];

const lintScript = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts.lint;
const steps = lintScript.split('&&').map((step) => step.trim()).filter(Boolean);
const groupOf = (step) => HEAVY_STEPS[step] ?? 'core';

for (const step of Object.keys(HEAVY_STEPS)) {
  if (!steps.includes(step)) {
    console.error(`run-lint-group: "${step}" is no longer in the lint script; update HEAVY_STEPS.`);
    process.exit(1);
  }
}

const arg = process.argv[2];
if (arg === '--list') {
  for (const group of GROUPS) console.log(`${group}: ${steps.filter((s) => groupOf(s) === group).join(' && ')}`);
  process.exit(0);
}
if (!GROUPS.includes(arg)) {
  console.error(`usage: run-lint-group.mjs <${GROUPS.join('|')}> | --list`);
  process.exit(2);
}

// `npm run` puts node_modules/.bin on PATH; bare steps like `eslint` need it too.
const binDir = join(fileURLToPath(new URL('..', import.meta.url)), 'node_modules', '.bin');
const env = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}` };

for (const step of steps.filter((s) => groupOf(s) === arg)) {
  console.log(`\n$ ${step}`);
  const result = spawnSync(step, { shell: true, stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
