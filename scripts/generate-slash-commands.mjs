#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const cliEntry = join(projectRoot, 'dist', 'cli', 'index.js');
const curationPath = join(projectRoot, 'scripts', 'slash-commands-curation.json');
const defaultManifestOutputPath = join(
  projectRoot,
  'packages',
  'contracts',
  'src',
  'composer-commands.generated.ts',
);

function parseOutputPath(args) {
  if (args.length === 0) return defaultManifestOutputPath;
  if (args.length === 2 && args[0] === '--manifest-out' && args[1]) {
    return resolve(projectRoot, args[1]);
  }
  console.error('usage: node scripts/generate-slash-commands.mjs [--manifest-out <path>]');
  process.exit(2);
}

function portableSyntax(value) {
  return value.replace(/^pan\b/, '/pan').replaceAll(/ {2,}/g, ' ');
}

function renderManifestModule(entries, insertOverrides, variants) {
  return [
    '// GENERATED FILE — do not edit by hand.',
    '// Source: the pan CLI command registry via `pan admin commands --json`.',
    '// Regenerate: npm run generate:slash-commands   (drift-gated by scripts/lint-slash-commands.sh)',
    'import type { ComposerCommandManifestEntry } from "./composer-commands"',
    '',
    'export const COMPOSER_COMMAND_MANIFEST: ComposerCommandManifestEntry[] = [',
    ...entries.map(entry => `  ${JSON.stringify(entry)},`),
    ']',
    '',
    `export const COMPOSER_COMMAND_INSERT_OVERRIDES: Readonly<Record<string, string>> = ${JSON.stringify(insertOverrides, null, 2)}`,
    '',
    'export const COMPOSER_COMMAND_VARIANTS = [',
    ...variants.map(variant => `  ${JSON.stringify(variant)},`),
    '] as const',
    '',
  ].join('\n');
}

const manifestOutputPath = parseOutputPath(process.argv.slice(2));

if (!existsSync(cliEntry)) {
  console.error("dist/cli/index.js not found — run 'npm run build:cli' first");
  process.exit(1);
}

const result = spawnSync('node', [cliEntry, 'admin', 'commands', '--json'], {
  cwd: projectRoot,
  encoding: 'utf8',
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

let commandTree;
try {
  commandTree = JSON.parse(result.stdout);
} catch (error) {
  console.error(`Could not parse command registry JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
if (!Array.isArray(commandTree)) {
  console.error('Command registry JSON must be an array');
  process.exit(1);
}

const curation = JSON.parse(await readFile(curationPath, 'utf8'));
const manifestEntries = commandTree.map(command => {
  const commandPath = command.path.join(' ');
  return {
    id: `pan-${command.path.join('-')}`,
    path: command.path,
    display: `/pan ${commandPath}`,
    description: command.description,
    args: command.args,
    options: command.options,
    aliases: command.aliases,
    category: curation.categories[command.path[0]] ?? 'CLI',
  };
});
const manifestPaths = new Set(manifestEntries.map(entry => entry.path.join(' ')));
const insertOverrides = Object.fromEntries(
  Object.entries(curation.insertOverrides).map(([path, insert]) => [path, portableSyntax(insert)]),
);
const variants = curation.extras.map(extra => {
  const path = extra.label
    .replace(/^pan\s+/, '')
    .split(/\s+/)
    .filter(part => !part.startsWith('--'));
  const canonicalPath = path.join(' ');
  if (!manifestPaths.has(canonicalPath)) {
    throw new Error(`Curated slash-command variant does not match a visible command: ${extra.label}`);
  }
  return {
    id: extra.id,
    path,
    display: portableSyntax(extra.label),
    description: extra.description,
    insert: portableSyntax(extra.insert),
    category: extra.category,
  };
});

await mkdir(dirname(manifestOutputPath), { recursive: true });
await writeFile(
  manifestOutputPath,
  renderManifestModule(manifestEntries, insertOverrides, variants),
  'utf8',
);
console.log(`Generated ${manifestEntries.length} composer commands at ${manifestOutputPath}`);
