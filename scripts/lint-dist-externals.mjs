#!/usr/bin/env node
//
// lint-dist-externals.mjs — every bare import left in `dist/` must be a
// declared runtime dependency.
//
// Background: PAN-3209. `npx @overdeck/core` crashed at startup with
// `ERR_MODULE_NOT_FOUND: Cannot find package 'posthog-node' imported from
// dist/review-status-*.js`. tsdown keeps `posthog-node` external — it is not
// inlined into the bundle — so Node has to resolve it from node_modules at
// import time. The `dependencies` entry was added later than the import, so a
// build shipped a `dist/` that imports a package the manifest never declares.
// Nothing failed at build time; the first symptom was a cryptic module-not-found
// crash in a user's terminal. Same bug class as PAN-1562 (`effect` declared
// devDependency-only), which `check-effect-versions.mjs` guards for one package.
// This guard covers every package, derived from the emitted bundle itself.
//
// The rule: for each `dist/**/*.js` that Node loads, every bare import
// specifier must resolve to a package declared in `dependencies`,
// `optionalDependencies`, or `peerDependencies`. A devDependency does NOT
// satisfy it — a published install has no devDependencies.
//
// The second rule covers the other half of the same contract: a declaration
// only helps if a consumer can actually resolve it. `@overdeck/core@0.46.0`
// and `0.47.0` declared `"effect-acp": "workspace:*"` in `dependencies` —
// a Bun/pnpm workspace protocol that npm cannot resolve from a registry
// tarball — so `npm install @overdeck/core` failed outright with
// `EUNSUPPORTEDPROTOCOL` for every user, whether or not dist imported it.
// So every consumer-installed dependency spec must be a real registry range.
//
// Wired into `npm run build` (via scripts/build-post-cli.mjs, after every
// bundle is emitted) and exposed as `npm run lint:dist-externals`. CI runs
// `npm run build`, so a dist importing an undeclared external cannot be
// published or npm-linked.
//
// Usage: node scripts/lint-dist-externals.mjs [--root <dir>]

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import ts from 'typescript';

const scriptRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const rootFlagIndex = process.argv.indexOf('--root');
const root = rootFlagIndex === -1 ? scriptRoot : process.argv[rootFlagIndex + 1];
if (!root) {
  console.error('usage: node scripts/lint-dist-externals.mjs [--root <dir>]');
  process.exit(2);
}

const distDir = join(root, 'dist');
const allowlistPath = join(root, 'scripts', 'dist-externals-allowlist.txt');

// Vite's browser output. These chunks are resolved by the browser from the
// bundle itself, never by Node from node_modules, so a bare specifier there is
// not a runtime dependency of the package.
const EXCLUDED_DIRS = [join('dist', 'dashboard', 'public')];

const BUILTINS = new Set(builtinModules);
const ISSUE_REF_RE = /([A-Z]+-[0-9]+|#[0-9]+)/;

/** Package name for a specifier: `@scope/pkg/sub` -> `@scope/pkg`, `pkg/sub` -> `pkg`. */
const packageNameOf = (specifier) => {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

/** Bare = resolved from node_modules, not a path and not a runtime-provided module. */
const isBareSpecifier = (specifier) =>
  Boolean(specifier) &&
  !specifier.startsWith('.') &&
  !specifier.startsWith('/') &&
  !specifier.startsWith('node:') &&
  !specifier.startsWith('bun:') &&
  !BUILTINS.has(packageNameOf(specifier));

const collectJsFiles = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const rel = relative(root, path);
      if (EXCLUDED_DIRS.some((excluded) => rel === excluded || rel.startsWith(excluded + sep))) continue;
      collectJsFiles(path, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(path);
    }
  }
  return out;
};

const readAllowlist = () => {
  const allowed = new Map();
  const malformed = [];
  if (!existsSync(allowlistPath)) return { allowed, malformed };
  const lines = readFileSync(allowlistPath, 'utf8').split('\n');
  for (const [index, line] of lines.entries()) {
    const text = line.trim();
    if (text === '' || text.startsWith('#')) continue;
    const hash = text.indexOf('#');
    const name = (hash === -1 ? text : text.slice(0, hash)).trim();
    const reason = hash === -1 ? '' : text.slice(hash + 1).trim();
    // Every exemption must name the issue that audited it, so the allowlist
    // cannot silently absorb a real missing dependency.
    if (!name || !ISSUE_REF_RE.test(reason)) {
      malformed.push(`${allowlistPath}:${index + 1}: expected "<package>  # <ISSUE-REF> <reason>", got "${text}"`);
      continue;
    }
    allowed.set(name, reason);
  }
  return { allowed, malformed };
};

if (!existsSync(distDir)) {
  console.error(`✗ dist externals check: ${distDir} does not exist. Run \`npm run build\` first.`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// devDependencies deliberately excluded: they are absent from a published
// install, which is exactly how PAN-3209 and PAN-1562 shipped broken.
const CONSUMER_INSTALLED_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const declared = new Set(CONSUMER_INSTALLED_FIELDS.flatMap((field) => Object.keys(pkg[field] ?? {})));

// Protocols a workspace-aware package manager understands locally but that no
// consumer can resolve from a published tarball. devDependencies may use them
// freely — a consumer never installs those.
const UNPUBLISHABLE_PROTOCOL = /^(workspace|catalog|link|file|portal):/;
const unresolvableSpecs = CONSUMER_INSTALLED_FIELDS.flatMap((field) =>
  Object.entries(pkg[field] ?? {})
    .filter(([, spec]) => UNPUBLISHABLE_PROTOCOL.test(spec))
    .map(([name, spec]) => ({ field, name, spec })),
);

const { allowed, malformed } = readAllowlist();

const files = collectJsFiles(distDir);
/** package name -> Set of dist files importing it */
const externals = new Map();

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  // detectJavaScriptImports=false keeps this to ES module syntax — static
  // `import`/`export ... from` and dynamic `import()`. That is precisely what
  // Node resolves in this ESM package. Enabling it would also match AMD/UMD
  // `define([...])` dependency arrays and the bundler's `__require` shim inside
  // inlined third-party code (e.g. `define(["protobufjs/minimal"], ...)`),
  // which Node never resolves — pure false positives.
  const preprocessed = ts.preProcessFile(source, true, false);
  for (const ref of preprocessed.importedFiles) {
    if (!isBareSpecifier(ref.fileName)) continue;
    const name = packageNameOf(ref.fileName);
    if (!externals.has(name)) externals.set(name, new Set());
    externals.get(name).add(relative(root, file));
  }
}

const missing = [...externals.keys()]
  .filter((name) => !declared.has(name) && !allowed.has(name))
  .sort();

const staleAllowlist = [...allowed.keys()].filter((name) => !externals.has(name)).sort();

const errors = [
  ...malformed,
  ...unresolvableSpecs.map(
    ({ field, name, spec }) =>
      `${field}.${name} is "${spec}" — a consumer installing from the registry cannot resolve that protocol, so \`npm install\` fails outright with EUNSUPPORTEDPROTOCOL. Move it to devDependencies if it is a build-time workspace input, or give it a published version range.`,
  ),
  ...missing.map((name) => {
    const importers = [...externals.get(name)].sort().slice(0, 3).join(', ');
    const classification = pkg.devDependencies?.[name]
      ? `it is a devDependency ("${pkg.devDependencies[name]}"), which a published install does not get`
      : 'it is not declared anywhere in package.json';
    return `${name} is imported by dist (${importers}) but ${classification}.`;
  }),
  ...staleAllowlist.map(
    (name) =>
      `${name} is in scripts/dist-externals-allowlist.txt but no dist bundle imports it — delete the stale entry.`,
  ),
];

if (errors.length > 0) {
  console.error('✗ dist externals check failed:\n');
  for (const error of errors) console.error(`  - ${error}`);
  console.error(
    '\nA bare import left external in dist/ is resolved by Node from node_modules at runtime.\n' +
      'If the package is not in "dependencies", anyone installing or npm-linking this build\n' +
      'crashes on import with ERR_MODULE_NOT_FOUND (PAN-3209).\n\n' +
      'Fix one of:\n' +
      '  1. Add it to "dependencies" in package.json (the usual fix), then run `bun install`.\n' +
      '  2. Bundle it instead of externalizing it (tsdown.config.ts / src/dashboard/server/tsdown.config.ts).\n' +
      '  3. If the import is deliberately optional and guarded at its call site, add it to\n' +
      '     scripts/dist-externals-allowlist.txt as "<package>  # <ISSUE-REF> <why it is safe>".\n',
  );
  process.exit(1);
}

console.log(
  `✓ dist externals OK — ${externals.size} external package${externals.size === 1 ? '' : 's'} across ${files.length} dist files, all declared` +
    (allowed.size > 0 ? ` (${allowed.size} allowlisted)` : '') +
    '.',
);
