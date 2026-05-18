import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  ensureInternalToken: vi.fn(),
  spinner: {
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  },
  ora: vi.fn(),
}));

vi.mock('../../../lib/config.js', () => ({
  getDashboardApiUrl: () => 'http://dashboard.test',
}));

vi.mock('../../../lib/internal-token.js', () => ({
  INTERNAL_TOKEN_HEADER: 'x-pan-test-token',
  ensureInternalToken: mocks.ensureInternalToken,
}));

vi.mock('ora', () => ({
  default: mocks.ora,
}));

import { recoverSwarmCommand, registerSwarmCommands } from '../swarm.js';

describe('swarm CLI recovery', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdinDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.ensureInternalToken.mockReturnValue('secret-token');
    mocks.spinner.start.mockReturnValue(mocks.spinner);
    mocks.ora.mockReturnValue(mocks.spinner);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (stdinDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
  });

  it.each(['retry', 'handoff'] as const)('posts %s recovery to the dashboard with the internal token', async (action) => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    await recoverSwarmCommand('pan-1194', '2', { action });

    expect(mocks.fetch).toHaveBeenCalledWith(
      `http://dashboard.test/api/swarm/PAN-1194/slot/2/recover`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-pan-test-token': 'secret-token',
        },
        body: JSON.stringify({ action }),
      }),
    );
    expect(mocks.spinner.succeed).toHaveBeenCalledWith(expect.stringContaining(`Slot 2 of PAN-1194 recovered via ${action}.`));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('allows drop recovery when --yes is provided', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    await recoverSwarmCommand('PAN-1194', '2', { action: 'drop', yes: true });

    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://dashboard.test/api/swarm/PAN-1194/slot/2/recover',
      expect.objectContaining({ body: JSON.stringify({ action: 'drop' }) }),
    );
  });

  it('requires --yes for non-interactive drop recovery', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    await expect(recoverSwarmCommand('PAN-1194', '2', { action: 'drop' })).rejects.toThrow('process.exit:1');

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--yes required for non-interactive drop'));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid actions before sending an HTTP request', async () => {
    await expect(recoverSwarmCommand('PAN-1194', '2', { action: 'merge' })).rejects.toThrow('process.exit:1');

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid --action: merge'));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('prints the server error and exits when recovery fails', async () => {
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'No failed-merge slot 2 exists for PAN-1194.' }) });

    await expect(recoverSwarmCommand('PAN-1194', '2', { action: 'retry' })).rejects.toThrow('process.exit:1');

    expect(mocks.spinner.fail).toHaveBeenCalledWith(expect.stringContaining('Failed: No failed-merge slot 2 exists for PAN-1194.'));
  });

  it('registers recover under swarm while preserving the dispatch form', () => {
    const program = new Command();
    registerSwarmCommands(program);

    const swarm = program.commands.find(command => command.name() === 'swarm');
    const recover = swarm?.commands.find(command => command.name() === 'recover');

    expect(swarm?.registeredArguments.map(argument => argument.name())).toEqual(['id']);
    expect(recover?.registeredArguments.map(argument => argument.name())).toEqual(['issueId', 'slotId']);
    const help = recover?.helpInformation() ?? '';
    expect(help).toContain('--action <action>');
    expect(help).toContain('retry, drop, or handoff');
    expect(help).toContain('marks the vBRIEF item done');
  });
});
