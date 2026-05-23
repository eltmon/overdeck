import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock('../../../lib/config.js', () => ({
  getDashboardApiUrlSync: () => 'http://dashboard.test',
}));

import { cancelAutoMergeCommand, registerMergeCommands } from '../merge.js';

describe('merge CLI commands', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts cancellation and prints confirmation when a pending auto-merge is cancelled', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ cancelled: true }) });

    await cancelAutoMergeCommand('pan-1234');

    expect(mocks.fetch).toHaveBeenCalledWith('http://dashboard.test/api/issues/PAN-1234/merge/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'cli' }),
    });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Cancelled auto-merge for PAN-1234'));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('prints an idempotent no-op message when no pending auto-merge exists', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ cancelled: false }) });

    await cancelAutoMergeCommand('PAN-1234');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No pending auto-merge for PAN-1234'));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits 2 when the auto-merge is already executing', async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ cancelled: false, error: 'Auto-merge already executing' }) });

    await expect(cancelAutoMergeCommand('PAN-1234')).rejects.toThrow('process.exit:2');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot cancel — auto-merge for PAN-1234 is already executing'));
  });

  it('exits 1 on unexpected dashboard errors', async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });

    await expect(cancelAutoMergeCommand('PAN-1234')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to cancel auto-merge for PAN-1234: boom'));
  });

  it('registers pan merge cancel help', () => {
    const program = new Command();
    registerMergeCommands(program);

    const merge = program.commands.find(command => command.name() === 'merge');
    const cancel = merge?.commands.find(command => command.name() === 'cancel');

    expect(cancel?.registeredArguments.map(argument => argument.name())).toEqual(['issueId']);
    expect(merge?.helpInformation()).toContain('cancel');
    expect(cancel?.description()).toBe('Cancel a pending auto-merge cooldown for an issue');
  });
});
