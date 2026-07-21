import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readPlatformConfigSync: vi.fn(),
  restartDashboard: vi.fn(),
  stopDashboard: vi.fn(),
}));

vi.mock('fs', async (importActual) => ({
  ...(await importActual<typeof import('fs')>()),
  existsSync: mocks.existsSync,
}));

vi.mock('../../../lib/platform-lifecycle.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/platform-lifecycle.js')>()),
  readPlatformConfigSync: mocks.readPlatformConfigSync,
  restartDashboard: mocks.restartDashboard,
  stopDashboard: mocks.stopDashboard,
}));

import { restartCommand } from '../restart.js';

describe('restartCommand workspace guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'cwd').mockReturnValue('/repo/workspaces/feature-pan-2727/src/cli');
    mocks.existsSync.mockImplementation((path: string) => path === '/repo/workspaces/feature-pan-2727/.git');
    mocks.restartDashboard.mockReturnValue(Effect.succeed(undefined));
    mocks.stopDashboard.mockReturnValue(Effect.succeed(undefined));
  });

  it.each([
    [{}, 'dashboard'],
    [{ full: true }, 'full'],
  ])('refuses a %s restart before any dashboard stop', async (options) => {
    await restartCommand(options);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(
      'Run this command from the primary checkout at /repo',
    ));
    expect(process.exitCode).toBe(2);
    expect(mocks.readPlatformConfigSync).not.toHaveBeenCalled();
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.stopDashboard).not.toHaveBeenCalled();
  });
});
