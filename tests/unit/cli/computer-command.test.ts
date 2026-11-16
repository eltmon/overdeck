import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const click = vi.fn();
const listApps = vi.fn();
const exitCli = vi.fn(async (_code: number) => undefined);

vi.mock('../../../src/lib/computer-use/commands.js', () => ({
  click: (...args: unknown[]) => click(...args),
  listApps: (...args: unknown[]) => listApps(...args),
}));
vi.mock('../../../src/cli/exit.js', () => ({ exitCli: (code: number) => exitCli(code) }));

const { registerComputerCommands } = await import('../../../src/cli/commands/computer.js');
const { ComputerUseError } = await import('../../../src/lib/computer-use/errors.js');

async function pan(...args: string[]): Promise<void> {
  const program = new Command().exitOverride();
  registerComputerCommands(program);
  await program.parseAsync(['node', 'pan', ...args]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pan computer (PAN-5452)', () => {
  it('registers exactly the 15 subcommand names', async () => {
    const program = new Command();
    registerComputerCommands(program);
    const computer = program.commands.find((c) => c.name() === 'computer');
    expect(computer).toBeDefined();
    const names = computer!.commands.map((c) => c.name());
    expect(names).toEqual([
      'capabilities',
      'list-apps',
      'list-windows',
      'get-app-state',
      'wait',
      'click',
      'perform-secondary-action',
      'set-value',
      'type-text',
      'press-key',
      'hotkey',
      'paste-text',
      'scroll',
      'drag',
      'release',
    ]);
  });

  it('passes click flags through to the mocked click function (ac2)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    click.mockResolvedValue({ response: { ok: true }, screenshot: null });

    await pan('computer', 'click', '--app', 'calc', '--element-index', '3', '--click-count', '2');

    expect(click).toHaveBeenCalledWith(expect.objectContaining({ app: 'calc', elementIndex: 3, clickCount: 2 }));
    log.mockRestore();
  });

  it('prints "pan computer: <message>" to stderr and exits 1 on a ComputerUseError (ac3)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    listApps.mockRejectedValue(new ComputerUseError('disabled', 'm'));

    await pan('computer', 'list-apps');

    expect(error).toHaveBeenCalledWith('pan computer: m');
    expect(exitCli).toHaveBeenCalledWith(1);
    error.mockRestore();
  });

  it('prints the JSON error shape to stdout with --json (ac3)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    listApps.mockRejectedValue(new ComputerUseError('disabled', 'm'));

    await pan('computer', 'list-apps', '--json');

    expect(log).toHaveBeenCalledWith(JSON.stringify({ ok: false, error: { code: 'disabled', message: 'm' } }));
    expect(exitCli).toHaveBeenCalledWith(1);
    log.mockRestore();
  });
});
