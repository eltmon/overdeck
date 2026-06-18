import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const mocks = vi.hoisted(() => ({
  ensureInternalTokenSync: vi.fn(),
}));

vi.mock('../../../lib/internal-token.js', () => ({
  INTERNAL_TOKEN_HEADER: 'x-pan-test-token',
  ensureInternalTokenSync: mocks.ensureInternalTokenSync,
}));

import { mergeCancelCommand, registerMergeCommands } from '../merge.js';

describe('merge CLI', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchImpl = vi.fn();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.ensureInternalTokenSync.mockReturnValue('secret-token');
    vi.stubEnv('OVERDECK_DASHBOARD_URL', 'http://dashboard.test/');
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('cancels a pending auto-merge with the internal token', async () => {
    fetchImpl.mockResolvedValue({ ok: true, status: 200, json: async () => ({ issueId: 'PAN-123' }) });

    await mergeCancelCommand('pan-123', fetchImpl as never);

    expect(fetchImpl).toHaveBeenCalledWith('http://dashboard.test/api/flywheel/auto-merge/PAN-123', {
      method: 'DELETE',
      headers: { 'x-pan-test-token': 'secret-token' },
    });
    expect(logSpy).toHaveBeenCalledWith('Cancelled auto-merge for PAN-123');
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('prints a non-zero cooldown-expired error when merge is already in progress', async () => {
    fetchImpl.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Auto-merge cooldown has expired for PAN-123; merge is in progress' }),
    });

    await mergeCancelCommand('PAN-123', fetchImpl as never);

    expect(errorSpy).toHaveBeenCalledWith('Auto-merge cooldown has expired for PAN-123; merge is in progress');
    expect(process.exitCode).toBe(1);
  });

  it('prints a non-zero missing-entry error', async () => {
    fetchImpl.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'No pending auto-merge for PAN-999' }),
    });

    await mergeCancelCommand('PAN-999', fetchImpl as never);

    expect(errorSpy).toHaveBeenCalledWith('No pending auto-merge for PAN-999');
    expect(process.exitCode).toBe(1);
  });

  it('registers pan merge cancel <id>', () => {
    const program = new Command();
    registerMergeCommands(program);

    const merge = program.commands.find(command => command.name() === 'merge');
    const cancel = merge?.commands.find(command => command.name() === 'cancel');

    expect(cancel?.registeredArguments.map(argument => argument.name())).toEqual(['id']);
  });
});
