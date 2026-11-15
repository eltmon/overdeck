/**
 * Bare `/pan` help (PAN-5348): lists the Overdeck commands from the generated
 * manifest, composer-runnable ones first, the rest grouped by category.
 * Built in-process; never spawns `pan --help`.
 */
import { COMPOSER_COMMAND_MANIFEST, type ComposerCommandResult } from '@overdeck/contracts';
import { expectedSyntax } from './parser.js';
import { resolvePolicy } from './policy.js';

const SYNTAX_COLUMN_MAX = 36;

interface HelpLine {
  syntax: string;
  description: string;
}

function isComposerRunnable(path: readonly string[]): boolean {
  return resolvePolicy(path).mode !== 'terminal-only';
}

function formatLine(line: HelpLine, columnWidth: number): string {
  const syntax = line.syntax.length < columnWidth ? line.syntax.padEnd(columnWidth) : line.syntax;
  return `  ${syntax}  ${line.description}`;
}

export function buildComposerHelpOutput(): string {
  const composerLines: HelpLine[] = COMPOSER_COMMAND_MANIFEST
    .filter(entry => isComposerRunnable(entry.path))
    .map(entry => ({ syntax: expectedSyntax(entry), description: entry.description }));

  const categoryOrder: string[] = [];
  const categoryLines = new Map<string, HelpLine[]>();
  for (const entry of COMPOSER_COMMAND_MANIFEST) {
    if (entry.path.length !== 1 || isComposerRunnable(entry.path)) continue;
    let lines = categoryLines.get(entry.category);
    if (lines === undefined) {
      lines = [];
      categoryOrder.push(entry.category);
      categoryLines.set(entry.category, lines);
    }
    lines.push({ syntax: expectedSyntax(entry).replace(/^\/pan /, 'pan '), description: entry.description });
  }

  const allLines = [...composerLines, ...categoryOrder.flatMap(category => categoryLines.get(category) ?? [])];
  const columnWidth = Math.min(
    SYNTAX_COLUMN_MAX,
    allLines.reduce((max, line) => Math.max(max, line.syntax.length), 0),
  );

  const lines: string[] = ['Overdeck commands', '', 'Run in this composer (type /pan <command>):'];
  for (const line of composerLines) lines.push(formatLine(line, columnWidth));

  lines.push('', 'Run in a terminal (type pan <command> in a shell):');
  for (const category of categoryOrder) {
    lines.push('', category);
    for (const line of categoryLines.get(category) ?? []) lines.push(formatLine(line, columnWidth));
  }

  lines.push('', 'Run pan <command> --help in a terminal for subcommands and options.');
  return lines.join('\n');
}

export function buildComposerHelpResult(): ComposerCommandResult {
  return {
    kind: 'captured',
    status: 'completed',
    command: '/pan help',
    output: buildComposerHelpOutput(),
    truncated: false,
  };
}
