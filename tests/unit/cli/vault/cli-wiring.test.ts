import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const fn = () => vi.fn(async (..._args: unknown[]) => undefined);
  return {
    setupCommand: fn(),
    joinCommand: fn(),
    passphraseSetCommand: fn(),
    passphraseRemoveCommand: fn(),
    rotateKeyCommand: fn(),
    statusCommand: fn(),
    saveCommand: fn(),
    syncCommand: fn(),
    listCommand: fn(),
    showCommand: fn(),
    resumeCommand: fn(),
    excludeCommand: fn(),
    includeCommand: fn(),
    allowSecretCommand: fn(),
    evictCommand: fn(),
    restoreCommand: fn(),
  };
});
vi.mock('../../../../src/cli/commands/vault/setup.js', () => ({ setupCommand: mocks.setupCommand }));
vi.mock('../../../../src/cli/commands/vault/join.js', () => ({ joinCommand: mocks.joinCommand }));
vi.mock('../../../../src/cli/commands/vault/passphrase.js', () => ({
  passphraseSetCommand: mocks.passphraseSetCommand,
  passphraseRemoveCommand: mocks.passphraseRemoveCommand,
}));
vi.mock('../../../../src/cli/commands/vault/rotate-key.js', () => ({ rotateKeyCommand: mocks.rotateKeyCommand }));
vi.mock('../../../../src/cli/commands/vault/status.js', () => ({ statusCommand: mocks.statusCommand }));
vi.mock('../../../../src/cli/commands/vault/save.js', () => ({ saveCommand: mocks.saveCommand }));
vi.mock('../../../../src/cli/commands/vault/sync.js', () => ({ syncCommand: mocks.syncCommand }));
vi.mock('../../../../src/cli/commands/vault/list.js', () => ({ listCommand: mocks.listCommand }));
vi.mock('../../../../src/cli/commands/vault/show.js', () => ({ showCommand: mocks.showCommand }));
vi.mock('../../../../src/cli/commands/vault/resume.js', () => ({ resumeCommand: mocks.resumeCommand }));
vi.mock('../../../../src/cli/commands/vault/exclude.js', () => ({
  excludeCommand: mocks.excludeCommand,
  includeCommand: mocks.includeCommand,
}));
vi.mock('../../../../src/cli/commands/vault/allow-secret.js', () => ({ allowSecretCommand: mocks.allowSecretCommand }));
vi.mock('../../../../src/cli/commands/vault/evict.js', () => ({ evictCommand: mocks.evictCommand }));
vi.mock('../../../../src/cli/commands/vault/restore.js', () => ({ restoreCommand: mocks.restoreCommand }));

import { registerVaultCommands } from '../../../../src/cli/commands/vault/index.js';

function program(): Command {
  const root = new Command();
  root.exitOverride();
  registerVaultCommands(root);
  return root;
}

/** Every runnable `vault` subcommand as its argv path, e.g. ['vault', 'passphrase', 'set']. */
function leafPaths(command: Command, path: string[] = []): { path: string[]; command: Command }[] {
  const here = [...path, command.name()];
  if (command.commands.length === 0) return [{ path: here, command }];
  return command.commands.flatMap((sub) => leafPaths(sub, here));
}

const vaultLeaves = leafPaths(program().commands.find((c) => c.name() === 'vault')!);

describe('pan vault Commander wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the verbs this test mocks', () => {
    expect(vaultLeaves.length).toBe(Object.keys(mocks).length);
  });

  it.each(vaultLeaves.map((leaf) => [leaf.path.join(' '), leaf] as const))(
    '%s never passes Commander\'s Command to its implementation',
    async (_name, leaf) => {
      const positionals = leaf.command.registeredArguments.filter((arg) => arg.required).map(() => 'x');
      await program().parseAsync(['node', 'pan', ...leaf.path, ...positionals]);

      const called = Object.values(mocks).filter((mock) => mock.mock.calls.length > 0);
      expect(called).toHaveLength(1);
      const args = called[0]!.mock.calls[0]!;
      expect(args.some((arg) => arg instanceof Command)).toBe(false);
      expect(args).toHaveLength(leaf.command.registeredArguments.length + 1);
      expect(typeof args[args.length - 1]).toBe('object');
    },
  );

  it('passes positionals and options to a verb with positionals', async () => {
    await program().parseAsync(['node', 'pan', 'vault', 'setup', '/srv/vault.git', '--passphrase-file', '/tmp/p']);

    expect(mocks.setupCommand.mock.calls[0]).toEqual(['/srv/vault.git', expect.objectContaining({ passphraseFile: '/tmp/p' })]);
  });
});
