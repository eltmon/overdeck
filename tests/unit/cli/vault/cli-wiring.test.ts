import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listCommand: vi.fn(async () => undefined),
  setupCommand: vi.fn(async () => undefined),
}));
vi.mock('../../../../src/cli/commands/vault/list.js', () => ({ listCommand: mocks.listCommand }));
vi.mock('../../../../src/cli/commands/vault/setup.js', () => ({ setupCommand: mocks.setupCommand }));

import { registerVaultCommands } from '../../../../src/cli/commands/vault/index.js';

function program(): Command {
  const root = new Command();
  root.exitOverride();
  registerVaultCommands(root);
  return root;
}

describe('pan vault Commander wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes only the options to a verb without positionals, so io keeps its default', async () => {
    await program().parseAsync(['node', 'pan', 'vault', 'list', '--json']);

    expect(mocks.listCommand).toHaveBeenCalledTimes(1);
    expect(mocks.listCommand.mock.calls[0]).toEqual([{ json: true }]);
  });

  it('passes positionals and options but never the Command to a verb with positionals', async () => {
    await program().parseAsync(['node', 'pan', 'vault', 'setup', '/srv/vault.git', '--passphrase-file', '/tmp/p']);

    expect(mocks.setupCommand).toHaveBeenCalledTimes(1);
    const args = mocks.setupCommand.mock.calls[0] as unknown[];
    expect(args[0]).toBe('/srv/vault.git');
    expect(args[1]).toMatchObject({ passphraseFile: '/tmp/p' });
    expect(args).toHaveLength(2);
    expect(args.some((arg) => arg instanceof Command)).toBe(false);
  });
});
