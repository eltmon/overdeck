// @vitest-environment node
/**
 * PAN-3286 WI-9 (NFR-5): the CLI half of the PAN-1990 no-loss audit — every
 * `pan workspace` and `pan memory` verb and flag that existed before PAN-3286
 * must still parse, and every surface PAN-3286 adds must be present and recorded
 * in docs/audits/pan-1990-surface-inventory.md.
 *
 * This lives beside no-loss-audit.test.ts rather than inside it because that file
 * runs under `@vitest-environment jsdom` for its React-component rows, and
 * importing the CLI command tree there fails — an SDK in the CLI import chain
 * refuses to initialize in a browser-like environment. The two files are one
 * gate; see the pointer comment at the top of no-loss-audit.test.ts.
 *
 * The expected pre-change surface below was extracted mechanically from
 * packages/contracts/src/composer-commands.generated.ts at this branch's
 * merge-base with origin/main — the manifest as it stood BEFORE PAN-3286 — never
 * written from memory. Deleting or renaming any verb or flag fails this test.
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const PRE_PAN_3286_WORKSPACE_SURFACE: Record<string, string[]> = {
  create: ['--dry-run', '--no-skills', '--labels', '--project', '--docker', '--remote', '--local'],
  migrate: ['--to', '--keep', '--force'],
  ssh: [],
  'sync-auth': [],
  start: [],
  stop: [],
  list: ['--json', '--all', '--kind', '--archived'],
  destroy: ['--force', '--project', '--purge-memory'],
  new: ['--project', '--isolated', '--parent-branch'],
  main: ['--project'],
  get: [],
  activate: [],
  archive: [],
  'render-devcontainer': ['--project', '--workspace', '--json'],
  'deep-clean': ['--yes'],
  rebuild: [],
  reap: ['--days', '--apply', '--yes'],
  update: ['--force'],
  'use-config': ['--project'],
  'add-repo': ['--dry-run', '--group', '--new', '--project'],
};

const PRE_PAN_3286_MEMORY_SURFACE: Record<string, string[]> = {
  search: ['--project', '--workspace', '--issue', '--tag', '--sibling', '--global', '--include-archived', '--limit', '--json'],
  status: ['--project', '--json'],
  reset: ['--project', '--reason', '--from', '--json'],
  summary: ['--project', '--date', '--json'],
  doctor: ['--project', '--json'],
  backfill: ['--workspace', '--project', '--dry-run', '--json'],
  pin: ['--project', '--workspace', '--json'],
  unpin: ['--project', '--workspace', '--json'],
  pins: ['--project', '--workspace', '--json'],
  config: ['--json'],
};

/** Surfaces PAN-3286 adds; asserted present so the inventory doc stays honest. */
const PAN_3286_ADDED_WORKSPACE_SURFACE: Record<string, string[]> = {
  new: ['--target-path', '--dry-run'],
  relocate: ['--path', '--force'],
};

const PAN_3286_ADDED_MEMORY_SURFACE: Record<string, string[]> = {
  search: ['--target'],
  status: ['--workspace', '--history'],
  summary: ['--workspace'],
  timeline: ['--workspace', '--days', '--limit', '--json'],
  read: ['--workspace', '--from', '--lines'],
};

/** Every new surface must be written down in the inventory doc, not just shipped. */
const INVENTORY_DOC_REQUIRED_MENTIONS = [
  '--target-path',
  '--dry-run',
  'workspace relocate',
  'memory search --target',
  'memory status --workspace',
  '--history',
  'memory timeline',
  'memory read',
  'memoryPhase',
  'pipeline worktrees',
  'rebuild-workspaces',
];

interface CommanderLike {
  name(): string;
  options: Array<{ long: string | null; short: string | null }>;
  commands: CommanderLike[];
  registeredArguments: Array<{ name(): string; required: boolean }>;
}

function flagNamesOf(command: CommanderLike): string[] {
  return command.options.map((option) => option.long ?? option.short ?? '').filter(Boolean);
}

async function workspaceSubcommands(): Promise<CommanderLike[]> {
  const { Command } = await import('commander');
  const { registerWorkspaceCommands } = await import('../../../src/cli/commands/workspace.js');
  const program = new Command();
  registerWorkspaceCommands(program);
  const workspace = (program.commands as unknown as CommanderLike[]).find((c) => c.name() === 'workspace');
  expect(workspace, 'pan workspace command group disappeared').toBeDefined();
  return workspace!.commands;
}

async function memorySubcommands(): Promise<CommanderLike[]> {
  const { createMemoryCommand } = await import('../../../src/cli/commands/memory.js');
  return createMemoryCommand().commands as unknown as CommanderLike[];
}

function assertSurface(subcommands: CommanderLike[], group: string, surface: Record<string, string[]>): void {
  for (const [verb, expectedFlags] of Object.entries(surface)) {
    const command = subcommands.find((c) => c.name() === verb);
    expect(command, `pan ${group} ${verb} is missing`).toBeDefined();
    const flags = flagNamesOf(command!);
    for (const flag of expectedFlags) {
      expect(flags, `pan ${group} ${verb} is missing ${flag}`).toContain(flag);
    }
  }
}

describe('PAN-3286 no-loss audit: pan workspace / pan memory CLI surface (NFR-5)', () => {
  it('keeps every pre-PAN-3286 pan workspace verb and flag', async () => {
    assertSurface(await workspaceSubcommands(), 'workspace', PRE_PAN_3286_WORKSPACE_SURFACE);
  });

  it('keeps every pre-PAN-3286 pan memory verb and flag', async () => {
    assertSurface(await memorySubcommands(), 'memory', PRE_PAN_3286_MEMORY_SURFACE);
  });

  it('keeps the pan memory status <issue> and summary <issue> positionals declared, now optional', async () => {
    const subcommands = await memorySubcommands();
    for (const verb of ['status', 'summary']) {
      const command = subcommands.find((c) => c.name() === verb)!;
      const args = command.registeredArguments;
      expect(args.map((a) => a.name()), `pan memory ${verb} lost its issue positional`).toEqual(['issue']);
      expect(args[0]!.required, `pan memory ${verb} issue positional should be optional after PAN-3286`).toBe(false);
    }
  });

  it('exposes every workspace and memory surface PAN-3286 adds', async () => {
    assertSurface(await workspaceSubcommands(), 'workspace', PAN_3286_ADDED_WORKSPACE_SURFACE);
    assertSurface(await memorySubcommands(), 'memory', PAN_3286_ADDED_MEMORY_SURFACE);
  });

  it('records every new surface in docs/audits/pan-1990-surface-inventory.md', async () => {
    const doc = await readFile('docs/audits/pan-1990-surface-inventory.md', 'utf8');
    for (const mention of INVENTORY_DOC_REQUIRED_MENTIONS) {
      expect(doc, `the inventory doc does not mention ${mention}`).toContain(mention);
    }
  });
});
