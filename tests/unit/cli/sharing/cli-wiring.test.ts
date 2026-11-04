import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  shareCommand: vi.fn(async (..._args: unknown[]) => undefined),
  joinCommand: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock('../../../../src/cli/commands/sharing/share.js', () => ({ shareCommand: mocks.shareCommand }));
vi.mock('../../../../src/cli/commands/sharing/join.js', () => ({ joinCommand: mocks.joinCommand }));

import { registerSharingCommands } from '../../../../src/cli/commands/sharing/index.js';

function program(): Command {
  const root = new Command();
  root.exitOverride();
  registerSharingCommands(root);
  return root;
}

async function run(...argv: string[]): Promise<void> {
  await program().parseAsync(['node', 'pan', ...argv]);
}

describe('pan share / pan join Commander wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes "share 42" to shareCommand with the ref and empty options', async () => {
    await run('share', '42');
    expect(mocks.shareCommand.mock.calls[0]).toEqual(['42', {}]);
  });

  it('routes "share conv-a --json" with { json: true }', async () => {
    await run('share', 'conv-a', '--json');
    expect(mocks.shareCommand.mock.calls[0]).toEqual(['conv-a', { json: true }]);
  });

  it('routes "join BCDF-GHJK" with { open: true }', async () => {
    await run('join', 'BCDF-GHJK');
    expect(mocks.joinCommand.mock.calls[0]).toEqual(['BCDF-GHJK', { open: true }]);
  });

  it('routes "join BCDF-GHJK --no-open" with { open: false }', async () => {
    await run('join', 'BCDF-GHJK', '--no-open');
    expect(mocks.joinCommand.mock.calls[0]).toEqual(['BCDF-GHJK', { open: false }]);
  });

  it('never passes Commander\'s Command to an implementation', async () => {
    await run('share', '42');
    await run('join', 'BCDF-GHJK');
    for (const call of [...mocks.shareCommand.mock.calls, ...mocks.joinCommand.mock.calls]) {
      expect(call.some((arg) => arg instanceof Command)).toBe(false);
    }
  });
});
