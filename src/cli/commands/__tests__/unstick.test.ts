import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerUnstickCommand, unstickCommand } from '../unstick.js';

describe('pan unstick', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  it('calls the canonical dashboard unstick route with an uppercase issue ID', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({
      success: true,
      issueId: 'PAN-3393',
      previousReason: 'feedback_delivery_needs_you',
    }));

    await unstickCommand('pan-3393', fetchImpl, 'http://dashboard.test/');

    expect(fetchImpl).toHaveBeenCalledWith('http://dashboard.test/api/workspaces/PAN-3393/unstick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(logSpy).toHaveBeenCalledWith(
      'Cleared stuck gate for PAN-3393 (was: feedback_delivery_needs_you).',
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('reports a route refusal and sets a non-zero exit code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(
      { success: false, error: 'Workspace git state is not yet repaired.' },
      { status: 409 },
    ));

    await unstickCommand('PAN-3393', fetchImpl, 'http://dashboard.test');

    expect(errorSpy).toHaveBeenCalledWith('Error: Workspace git state is not yet repaired.');
    expect(process.exitCode).toBe(1);
  });

  it('registers pan unstick <id>', () => {
    const program = new Command();
    registerUnstickCommand(program);

    const command = program.commands.find(candidate => candidate.name() === 'unstick');
    expect(command?.registeredArguments.map(argument => argument.name())).toEqual(['id']);
  });

  it('does not pass the Commander options object as the fetch implementation', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(Response.json({ success: true, issueId: 'PAN-3393' }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubEnv('OVERDECK_DASHBOARD_URL', 'http://dashboard.test');

    const program = new Command();
    program.exitOverride();
    registerUnstickCommand(program);
    await program.parseAsync(['node', 'pan', 'unstick', 'pan-3393']);

    expect(fetchSpy).toHaveBeenCalledWith('http://dashboard.test/api/workspaces/PAN-3393/unstick', expect.any(Object));
  });
});
