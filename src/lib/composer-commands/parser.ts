import {
  COMPOSER_COMMAND_MANIFEST,
  type ComposerCommandManifestEntry,
  type ComposerCommandOption,
} from '@overdeck/contracts';

export type ComposerCommandParseErrorCode =
  | 'unknown-command'
  | 'missing-argument'
  | 'unknown-flag'
  | 'forbidden-token';

export class ComposerCommandParseError extends Error {
  constructor(
    readonly code: ComposerCommandParseErrorCode,
    message: string,
    readonly token: string,
    readonly expected: string,
  ) {
    super(message);
    this.name = 'ComposerCommandParseError';
  }
}

export interface ParsedOverdeckComposerCommand {
  entry: ComposerCommandManifestEntry;
  argv: string[];
}

interface OptionDefinition {
  option: ComposerCommandOption;
  canonicalFlag: string;
}

const FORBIDDEN_TOKEN = /\$\(|[;|&<>`]/;

function expectedSyntax(entry: ComposerCommandManifestEntry): string {
  const args = entry.args.map(argument => {
    const name = argument.variadic ? `${argument.name}...` : argument.name;
    return argument.required ? `<${name}>` : `[${name}]`;
  });
  const options = entry.options.length > 0 ? ['[options]'] : [];
  return [entry.display, ...args, ...options].join(' ');
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  const pushCurrent = () => {
    if (current.length === 0) return;
    tokens.push(current);
    current = '';
  };

  for (const character of input) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      pushCurrent();
      continue;
    }
    current += character;
  }

  if (escaped) current += '\\';
  if (quote !== null) {
    throw new ComposerCommandParseError(
      'missing-argument',
      `Unclosed ${quote} quote. Close the quoted value before submitting the command.`,
      quote,
      `a closing ${quote}`,
    );
  }
  pushCurrent();
  return tokens;
}

function aliasesForPath(entry: ComposerCommandManifestEntry): string[][] {
  let candidates: string[][] = [[]];
  for (let index = 0; index < entry.path.length; index += 1) {
    const prefix = entry.path.slice(0, index + 1);
    const prefixEntry = COMPOSER_COMMAND_MANIFEST.find(candidate =>
      candidate.path.length === prefix.length &&
      candidate.path.every((part, partIndex) => part === prefix[partIndex]));
    const names = [entry.path[index], ...(prefixEntry?.aliases ?? [])];
    candidates = candidates.flatMap(candidate => names.map(name => [...candidate, name]));
  }
  return candidates;
}

function resolveEntry(tokens: readonly string[]): { entry: ComposerCommandManifestEntry; pathLength: number } {
  const matches = COMPOSER_COMMAND_MANIFEST.flatMap(entry =>
    aliasesForPath(entry)
      .filter(path => path.every((part, index) => tokens[index] === part))
      .map(path => ({ entry, pathLength: path.length })));
  const match = matches.sort((left, right) => right.pathLength - left.pathLength)[0];
  if (match) return match;

  const token = tokens[0] ?? '';
  throw new ComposerCommandParseError(
    'unknown-command',
    token
      ? `Unknown Overdeck command "${token}". Type /pan to list available commands.`
      : 'Missing an Overdeck command after /pan. Type /pan to list available commands.',
    token,
    '/pan <command>',
  );
}

function optionDefinitions(entry: ComposerCommandManifestEntry): Map<string, OptionDefinition> {
  const definitions = new Map<string, OptionDefinition>();
  for (const option of entry.options) {
    const flags = option.flags
      .split(/[ ,|]+/)
      .filter(part => part.startsWith('-'));
    const canonicalFlag = flags.find(flag => flag.startsWith('--')) ?? flags[0];
    for (const flag of flags) definitions.set(flag, { option, canonicalFlag });
  }
  return definitions;
}

function splitFlag(token: string): { flag: string; inlineValue?: string } {
  const separator = token.indexOf('=');
  if (separator === -1) return { flag: token };
  return {
    flag: token.slice(0, separator),
    inlineValue: token.slice(separator + 1),
  };
}

export function parseOverdeckComposerCommand(
  message: string,
): ParsedOverdeckComposerCommand | null {
  if (!/^\/pan(?:\s|$)/.test(message)) return null;

  const forbidden = message.match(FORBIDDEN_TOKEN)?.[0];
  if (forbidden !== undefined) {
    throw new ComposerCommandParseError(
      'forbidden-token',
      `The token "${forbidden}" is not allowed in /pan commands. Run compound shell syntax in a terminal instead.`,
      forbidden,
      'plain arguments without shell operators',
    );
  }

  const tokens = tokenize(message.slice(4).trim());
  const { entry, pathLength } = resolveEntry(tokens);
  const remaining = tokens.slice(pathLength);
  const definitions = optionDefinitions(entry);
  const positionals: string[] = [];
  const flags: string[] = [];

  for (let index = 0; index < remaining.length; index += 1) {
    const token = remaining[index];
    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }

    const { flag, inlineValue } = splitFlag(token);
    const definition = definitions.get(flag);
    if (definition === undefined) {
      throw new ComposerCommandParseError(
        'unknown-flag',
        `Unknown flag "${flag}" for ${entry.display}. Expected syntax: ${expectedSyntax(entry)}.`,
        flag,
        expectedSyntax(entry),
      );
    }

    flags.push(definition.canonicalFlag);
    if (definition.option.valueHint === null) {
      if (inlineValue !== undefined) {
        throw new ComposerCommandParseError(
          'unknown-flag',
          `Flag "${flag}" does not accept a value. Expected syntax: ${expectedSyntax(entry)}.`,
          token,
          expectedSyntax(entry),
        );
      }
      continue;
    }

    if (inlineValue !== undefined) {
      if (inlineValue.length === 0 && definition.option.required) {
        throw new ComposerCommandParseError(
          'missing-argument',
          `Flag "${flag}" requires <${definition.option.valueHint}>. Expected syntax: ${expectedSyntax(entry)}.`,
          flag,
          expectedSyntax(entry),
        );
      }
      if (inlineValue.length > 0) flags.push(inlineValue);
      continue;
    }

    const next = remaining[index + 1];
    const nextIsFlag = next?.startsWith('-') === true;
    if (definition.option.required && (next === undefined || nextIsFlag)) {
      throw new ComposerCommandParseError(
        'missing-argument',
        `Flag "${flag}" requires <${definition.option.valueHint}>. Expected syntax: ${expectedSyntax(entry)}.`,
        flag,
        expectedSyntax(entry),
      );
    }
    if (next !== undefined && !nextIsFlag) {
      flags.push(next);
      index += 1;
    }
  }

  const variadic = entry.args.at(-1)?.variadic === true;
  if (!variadic && positionals.length > entry.args.length) {
    const token = positionals[entry.args.length];
    throw new ComposerCommandParseError(
      'unknown-command',
      `Unexpected token "${token}" for ${entry.display}. Expected syntax: ${expectedSyntax(entry)}.`,
      token,
      expectedSyntax(entry),
    );
  }
  const missing = entry.args.find((argument, index) => argument.required && positionals[index] === undefined);
  if (missing !== undefined) {
    throw new ComposerCommandParseError(
      'missing-argument',
      `Missing required argument <${missing.name}> for ${entry.display}. Expected syntax: ${expectedSyntax(entry)}.`,
      missing.name,
      expectedSyntax(entry),
    );
  }

  return {
    entry,
    argv: [...entry.path, ...positionals, ...flags],
  };
}
