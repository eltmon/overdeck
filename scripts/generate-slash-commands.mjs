#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const cliEntry = join(projectRoot, 'dist', 'cli', 'index.js');
const curationPath = join(projectRoot, 'scripts', 'slash-commands-curation.json');
const defaultOutputPath = join(
  projectRoot,
  'src',
  'dashboard',
  'frontend',
  'src',
  'components',
  'chat',
  'slashCommands.generated.ts',
);
const defaultManifestOutputPath = join(
  projectRoot,
  'packages',
  'contracts',
  'src',
  'composer-commands.generated.ts',
);

function parseOutputPaths(args) {
  const paths = {
    outputPath: defaultOutputPath,
    manifestOutputPath: defaultManifestOutputPath,
  };

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || (flag !== '--out' && flag !== '--manifest-out')) {
      console.error(
        'usage: node scripts/generate-slash-commands.mjs [--out <path>] [--manifest-out <path>]',
      );
      process.exit(2);
    }
    paths[flag === '--out' ? 'outputPath' : 'manifestOutputPath'] = resolve(projectRoot, value);
  }

  return paths;
}

function firstSentence(description) {
  const sentence = description.split('. ')[0];
  if (sentence.length <= 100) return sentence;
  return `${sentence.slice(0, 99).trimEnd()}…`;
}

function quote(value) {
  return `'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')}'`;
}

function renderEntry(entry) {
  return [
    '  {',
    `    id: ${quote(entry.id)},`,
    `    label: ${quote(entry.label)},`,
    `    description: ${quote(entry.description)},`,
    `    insert: ${quote(entry.insert)},`,
    `    category: ${quote(entry.category)},`,
    '  },',
  ].join('\n');
}

function renderModule(entries) {
  return [
    '// GENERATED FILE — do not edit by hand.',
    '// Source: the pan CLI command registry via `pan admin commands --json`.',
    '// Regenerate: npm run generate:slash-commands   (drift-gated by scripts/lint-slash-commands.sh)',
    "import type { SlashCommand } from './slashCommandTypes';",
    '',
    'export const GENERATED_SLASH_COMMANDS: SlashCommand[] = [',
    ...entries.map(renderEntry),
    '];',
    '',
  ].join('\n');
}

function renderManifestModule(entries) {
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
  ].join('\n');
}

const { outputPath, manifestOutputPath } = parseOutputPaths(process.argv.slice(2));

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
const generatedEntries = commandTree
  .filter(command => !command.hasSubcommands || command.args.length > 0)
  .filter(command => {
    const commandPath = command.path.join(' ');
    return !curation.deny.some(prefix => commandPath === prefix || commandPath.startsWith(`${prefix} `));
  })
  .map(command => {
    const commandPath = command.path.join(' ');
    const label = `pan ${commandPath}`;
    return {
      id: `pan-${command.path.join('-')}`,
      label,
      description: firstSentence(command.description),
      insert: curation.insertOverrides[commandPath] ?? `${label}${command.args.length > 0 ? ' ' : ''}`,
      category: curation.categories[command.path[0]] ?? 'CLI',
    };
  });

const entries = [...generatedEntries, ...curation.extras];
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

await Promise.all([
  mkdir(dirname(outputPath), { recursive: true }),
  mkdir(dirname(manifestOutputPath), { recursive: true }),
]);
await Promise.all([
  writeFile(outputPath, renderModule(entries), 'utf8'),
  writeFile(manifestOutputPath, renderManifestModule(manifestEntries), 'utf8'),
]);
console.log(`Generated ${entries.length} slash commands at ${outputPath}`);
console.log(`Generated ${manifestEntries.length} composer commands at ${manifestOutputPath}`);
