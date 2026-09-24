/**
 * PAN-3868 / PAN-3934: every `pan <verb>` that ships to an agent must be a
 * command the CLI actually registers.
 *
 * The work-agent stop hook nudged agents to run `pan work done`, a verb that no
 * longer existed; an agent guessed at a replacement and reset its own gates.
 * Role prompts kept naming verbs the Cut deleted (`pan approve`, `pan review
 * pending`, `pan flywheel emit-status`, ...). This test reads the agent-facing
 * text (hooks, role prompts, runtime prompts, bundled agent definitions and
 * rules) and checks each named command against the CLI registry.
 *
 * The registry is `COMPOSER_COMMAND_MANIFEST`, generated from
 * `pan admin commands --json` and drift-gated against the real CLI by
 * `scripts/lint-slash-commands.sh`, so it cannot silently fall behind.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPOSER_COMMAND_MANIFEST } from '../../../packages/contracts/src/composer-commands.generated.js';

const ROOT = process.cwd();

/**
 * Agent-facing text roots: hooks, prompts, bundled agents, rules and skills,
 * plus the user-facing .mdx CLI and feature docs. Hooks are scanned whole;
 * Markdown only in code spans and fences.
 */
const HOOK_ROOTS = ['sync-sources/hooks'];
const MARKDOWN_ROOTS = [
  'roles',
  'src/lib/cloister/prompts',
  'sync-sources/agents',
  'sync-sources/rules',
  'sync-sources/skills',
  'sync-sources/dev-skills',
  'cli',
  'features',
  'reference',
];

/**
 * Files that name unbuilt verbs on purpose. Each entry says why; the test
 * proves the file still exists so a stale exclusion cannot linger.
 */
const PROPOSAL_DOCS: Record<string, string> = {
  'reference/template-conversations.mdx':
    'research proposal: sketches `pan bundle` / `pan template` and says they do not exist yet',
};

/**
 * Hidden commands are registered but absent from the manifest (it lists only
 * visible commands). Each entry names the source file that registers it, and
 * the test proves the registration is still there.
 */
const HIDDEN_COMMANDS: Record<string, { file: string; registration: string }> = {
  'review spawn-reviewer': {
    file: 'src/cli/commands/review-subcommands.ts',
    registration: ".command('spawn-reviewer <id>', { hidden: true })",
  },
};

interface Registry {
  paths: Set<string>;
  topLevel: Set<string>;
  hasSubcommands: Set<string>;
}

function buildRegistry(): Registry {
  const paths = new Set<string>();
  const topLevel = new Set<string>();
  const hasSubcommands = new Set<string>();
  for (const entry of COMPOSER_COMMAND_MANIFEST) {
    const names = [entry.path[entry.path.length - 1]!, ...entry.aliases];
    const parent = entry.path.slice(0, -1);
    for (const name of names) {
      paths.add([...parent, name].join(' '));
      if (parent.length === 0) topLevel.add(name);
    }
    if (parent.length > 0) hasSubcommands.add(parent.join(' '));
  }
  for (const hidden of Object.keys(HIDDEN_COMMANDS)) {
    paths.add(hidden);
    const parts = hidden.split(' ');
    if (parts.length === 1) topLevel.add(hidden);
    else hasSubcommands.add(parts.slice(0, -1).join(' '));
  }
  return { paths, topLevel, hasSubcommands };
}

function* walk(path: string): Generator<string> {
  const stat = statSync(path);
  if (stat.isFile()) {
    yield path;
    return;
  }
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    yield* walk(join(path, entry));
  }
}

const COMMAND = /(?<![\w/.-])pan((?: [a-z][a-z0-9-]*)+)/g;

/** Each `pan <word> [<word> ...]` reference, as its words after `pan`. */
function commandsIn(text: string): string[][] {
  const found: string[][] = [];
  for (const match of text.matchAll(COMMAND)) {
    found.push(match[1]!.trim().split(' '));
  }
  return found;
}

/** Code spans and fenced blocks: the parts of Markdown an agent would run. */
function markdownCode(text: string): { line: number; code: string }[] {
  const out: { line: number; code: string }[] = [];
  let inFence = false;
  text.split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) {
      out.push({ line: index + 1, code: line });
      return;
    }
    for (const span of line.matchAll(/`([^`]+)`/g)) out.push({ line: index + 1, code: span[1]! });
  });
  return out;
}

/** Returns the unregistered command prefix, or null when the reference resolves. */
function unregistered(words: string[], registry: Registry): string | null {
  const [top] = words;
  if (!top || !registry.topLevel.has(top)) return `pan ${top ?? ''}`.trim();
  let path = top;
  for (const word of words.slice(1)) {
    if (!registry.hasSubcommands.has(path)) return null;
    const next = `${path} ${word}`;
    if (!registry.paths.has(next)) return `pan ${next}`;
    path = next;
  }
  return null;
}

function scan(): string[] {
  const registry = buildRegistry();
  const problems: string[] = [];
  const check = (file: string, line: number, text: string) => {
    for (const words of commandsIn(text)) {
      const bad = unregistered(words, registry);
      if (bad) problems.push(`${relative(ROOT, file)}:${line}: ${bad}`);
    }
  };

  for (const root of HOOK_ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      if (/\.(js|d\.ts)$/.test(file)) continue; // built output of the .ts sources
      readFileSync(file, 'utf-8').split('\n').forEach((text, index) => check(file, index + 1, text));
    }
  }
  for (const root of MARKDOWN_ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      if (!/\.mdx?$/.test(file) || relative(ROOT, file) in PROPOSAL_DOCS) continue;
      for (const { line, code } of markdownCode(readFileSync(file, 'utf-8'))) check(file, line, code);
    }
  }
  return problems;
}

describe('agent-facing text names only registered pan commands (PAN-3868, PAN-3934)', () => {
  it('resolves every pan command in hooks, prompts, agents, rules, skills and CLI docs', () => {
    expect(scan()).toEqual([]);
  });

  it('never tells an agent to run the deleted `pan work done` verb', () => {
    const registry = buildRegistry();
    expect(unregistered(['work', 'done'], registry)).toBe('pan work');
    expect(unregistered(['done'], registry)).toBeNull();
  });

  it('keeps each proposal-doc exclusion pointing at a real file', () => {
    for (const file of Object.keys(PROPOSAL_DOCS)) {
      expect(statSync(join(ROOT, file)).isFile()).toBe(true);
    }
  });

  it('keeps each hidden-command exception backed by its registration', () => {
    for (const { file, registration } of Object.values(HIDDEN_COMMANDS)) {
      expect(readFileSync(join(ROOT, file), 'utf-8')).toContain(registration);
    }
  });
});
