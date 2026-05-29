#!/usr/bin/env node
//
// check-effect-versions.mjs — guard against Effect version drift.
//
// Background: PAN-1562. A published `@panctl/cli` shipped with `effect`
// declared only as a devDependency (`"effect": "catalog:"`), never as a
// runtime dependency. When installed via npx/npm, `effect` resolved
// transitively through `@effect/platform-node`'s peer range
// `effect: "^4.0.0-beta.NN"`, which floats to the newest beta. The floated
// beta's `MaxBodySize` API was incompatible with the bundled platform-node,
// so every request that read a body threw
// `IncomingMessage.MaxBodySize.asEffect is not a function`.
//
// The fix is a single-version pinning discipline:
//   1. `effect` MUST be a direct runtime dependency, pinned to the exact
//      catalog version (not devDependency-only, not `catalog:`-only).
//   2. Every `effect` / `@effect/*` spec across the workspace MUST be either
//      the exact catalog version or a `catalog:` reference — never a caret/
//      tilde range, never a different exact version.
//
// `@effect/language-service` is a TypeScript LSP tool versioned independently
// (0.x) and is excluded from the pinned runtime set.
//
// Wired into `npm run lint` via the `lint:effect` script. Fails CI on drift.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Tooling package versioned on its own track — not part of the pinned set. */
const EXCLUDED = new Set(['@effect/language-service']);

const isEffectPkg = (name) =>
  (name === 'effect' || name.startsWith('@effect/')) && !EXCLUDED.has(name);

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const errors = [];

const rootPkg = readJson(join(repoRoot, 'package.json'));
const catalog = rootPkg.workspaces?.catalog ?? {};

// 1. The catalog is the single source of truth. `effect` must be present and
//    pinned to an exact version (no range operator, no `catalog:` self-ref).
const expected = catalog.effect;
if (!expected) {
  errors.push('workspaces.catalog.effect is missing — the catalog must pin an exact effect version.');
} else if (/^[\^~]/.test(expected) || expected === 'catalog:') {
  errors.push(`workspaces.catalog.effect must be an exact version, got "${expected}".`);
}

// 2. `effect` must be a direct runtime dependency pinned to the exact catalog
//    version — the core invariant that prevents the published-package drift.
const runtimeEffect = rootPkg.dependencies?.effect;
if (!runtimeEffect) {
  errors.push('effect must be a direct runtime dependency in the root "dependencies" (it was devDependency-only — the exact bug this guard prevents).');
} else if (expected && runtimeEffect !== expected) {
  errors.push(`root dependencies.effect must equal the catalog version "${expected}", got "${runtimeEffect}".`);
}

// 3. Every effect-ecosystem spec across the workspace must be exact-catalog or `catalog:`.
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

const checkSpec = (where, name, spec) => {
  if (spec === 'catalog:') return; // inherits the catalog version
  if (spec === expected) return;
  errors.push(`${where}: ${name}@"${spec}" disagrees with catalog "${expected}" — pin to "${expected}" or use "catalog:".`);
};

// Root catalog + overrides.
for (const [name, spec] of Object.entries(catalog)) {
  if (isEffectPkg(name)) checkSpec('workspaces.catalog', name, spec);
}
for (const [name, spec] of Object.entries(rootPkg.overrides ?? {})) {
  if (isEffectPkg(name)) checkSpec('overrides', name, spec);
}

// Every workspace package.json (root + members).
const memberDirs = rootPkg.workspaces?.packages ?? [];
const pkgPaths = ['package.json', ...memberDirs.map((d) => join(d, 'package.json'))];

for (const rel of pkgPaths) {
  let pkg;
  try {
    pkg = readJson(join(repoRoot, rel));
  } catch {
    continue; // workspace member without a package.json (e.g. glob miss) — skip
  }
  for (const field of DEP_FIELDS) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (isEffectPkg(name)) checkSpec(`${rel} (${field})`, name, spec);
    }
  }
}

if (errors.length > 0) {
  console.error('✗ Effect version pinning check failed:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\nSee scripts/check-effect-versions.mjs (PAN-1562) for the pinning discipline.');
  process.exit(1);
}

console.log(`✓ Effect pinning OK — all effect/@effect/* on ${expected}, effect is a direct runtime dependency.`);
