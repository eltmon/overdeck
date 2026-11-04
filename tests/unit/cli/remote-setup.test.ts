/**
 * PAN-4682 WI-3: `pan remote setup` must not seed `[remote.fly] image` — the
 * derived default (`defaultFlyImage()` in fly-provider.ts) follows `app`, so
 * writing the literal would pin it and break if the operator later edits `app`.
 */
import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

vi.mock('../../../src/lib/config.js', () => ({
  loadConfigSync: () => ({}),
  saveConfig: vi.fn(),
}));

vi.mock('../../../src/lib/remote/index.js', () => ({
  createFlyProvider: () => ({ isAuthenticated: () => Effect.succeed(true) }),
}));

vi.mock('child_process', () => ({
  exec: (
    _command: string,
    _options: unknown,
    callback: (error: null, result: { stdout: string; stderr: string }) => void,
  ) => callback(null, { stdout: '', stderr: '' }),
}));

vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ succeed: () => undefined, warn: () => undefined }),
  }),
}));

describe('pan remote setup (PAN-4682 WI-3)', () => {
  it('seeds [remote.fly] without an image key', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const { setupCommand } = await import('../../../src/cli/commands/remote/setup.js');
    const { saveConfig } = await import('../../../src/lib/config.js');

    await setupCommand();

    expect(saveConfig).toHaveBeenCalledTimes(1);
    const saved = (saveConfig as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      remote: { fly: { app: string } };
    };
    expect(saved.remote.fly.app).toBe('pan-workspaces');
    expect('image' in saved.remote.fly).toBe(false);
  });
});
