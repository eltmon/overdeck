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

function parseOutputPath(args) {
  if (args.length === 0) return defaultOutputPath;
  if (args.length === 2 && args[0] === '--out' && args[1]) {
    return resolve(projectRoot, args[1]);
  }
  console.error('usage: node scripts/generate-slash-commands.mjs [--out <path>]');
  process.exit(2);
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

const outputPath = parseOutputPath(process.argv.slice(2));

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
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, renderModule(entries), 'utf8');
console.log(`Generated ${entries.length} slash commands at ${outputPath}`);
