/**
 * Unit tests for Fly token sources (PAN-4748).
 *
 * All flyctl/file-system access is injected — no real flyctl spawn, no real
 * timers. `_resetFlyTokenStateForTests()` clears the process-wide refresh
 * state between tests since it is shared across every `flyctlTokenSource`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: unknown, result?: unknown) => void;
    const file = args[0] as string;
    const fileArgs = args[1] as string[];
    const options = args.length > 3 ? (args[2] as Record<string, unknown>) : undefined;
    const result = mockExecFile(file, fileArgs, options);
    Promise.resolve(result).then(
      (val) => cb(null, val),
      (err) => cb(err),
    );
  },
}));

import {
  flyctlTokenSource,
  staticFlyTokenSource,
  _resetFlyTokenStateForTests,
} from '../../../src/lib/remote/fly-token.js';

describe('fly token sources', () => {
  beforeEach(() => {
    _resetFlyTokenStateForTests();
    mockExecFile.mockReset();
  });

  describe('flyctlTokenSource', () => {
    it('refresh returns the token flyctl prints and current() returns it afterwards', async () => {
      const runFlyctl = vi.fn().mockResolvedValue('{"token":"fm2_new"}');
      const readStoredToken = vi.fn().mockResolvedValue('fm2_old');
      const source = flyctlTokenSource('fm2_old', { runFlyctl, readStoredToken, now: () => 0 });

      const fresh = await source.refresh?.('fm2_old');

      expect(fresh).toBe('fm2_new');
      await expect(source.current()).resolves.toBe('fm2_new');
      expect(runFlyctl).toHaveBeenCalledTimes(1);
    });

    it('strips FLY_API_TOKEN and FLY_ACCESS_TOKEN from the flyctl env', async () => {
      process.env.FLY_API_TOKEN = 'should-not-leak';
      process.env.FLY_ACCESS_TOKEN = 'should-not-leak-either';
      mockExecFile.mockResolvedValue({ stdout: '{"token":"fm2_new"}', stderr: '' });

      try {
        const source = flyctlTokenSource('fm2_old');
        await source.refresh?.('fm2_old');

        expect(mockExecFile).toHaveBeenCalledTimes(1);
        const [file, fileArgs, options] = mockExecFile.mock.calls[0] as [string, string[], { env: Record<string, string | undefined> }];
        expect(file).toBe('flyctl');
        expect(fileArgs).toEqual(['auth', 'token', '--quiet', '--json']);
        expect(options.env).not.toHaveProperty('FLY_API_TOKEN');
        expect(options.env).not.toHaveProperty('FLY_ACCESS_TOKEN');
      } finally {
        delete process.env.FLY_API_TOKEN;
        delete process.env.FLY_ACCESS_TOKEN;
      }
    });

    it('concurrent refreshes share one flyctl run', async () => {
      let resolveRunFlyctl!: (value: string) => void;
      const runFlyctl = vi.fn().mockImplementation(
        () => new Promise<string>((resolve) => { resolveRunFlyctl = resolve; }),
      );
      const readStoredToken = vi.fn().mockResolvedValue(undefined);
      const source = flyctlTokenSource('fm2_old', { runFlyctl, readStoredToken, now: () => 0 });

      const first = source.refresh?.('fm2_old');
      const second = source.refresh?.('fm2_old');
      resolveRunFlyctl('{"token":"fm2_new"}');

      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(runFlyctl).toHaveBeenCalledTimes(1);
      expect(firstResult).toBe('fm2_new');
      expect(secondResult).toBe('fm2_new');
    });

    it('a failed refresh returns null and suppresses flyctl for 60 s', async () => {
      let now = 0;
      const runFlyctl = vi.fn().mockRejectedValue(new Error('flyctl auth token exited 1'));
      const readStoredToken = vi.fn().mockResolvedValue(undefined);
      const source = flyctlTokenSource('fm2_old', { runFlyctl, readStoredToken, now: () => now });

      now = 0;
      const first = await source.refresh?.('fm2_old');
      expect(first).toBeNull();
      expect(runFlyctl).toHaveBeenCalledTimes(1);

      now = 59_999;
      const second = await source.refresh?.('fm2_old');
      expect(second).toBeNull();
      expect(runFlyctl).toHaveBeenCalledTimes(1);

      now = 60_000;
      const third = await source.refresh?.('fm2_old');
      expect(third).toBeNull();
      expect(runFlyctl).toHaveBeenCalledTimes(2);
    });

    it('flyctl printing the rejected token counts as failure', async () => {
      const runFlyctl = vi.fn().mockResolvedValue('{"token":"fm2_old"}');
      const readStoredToken = vi.fn().mockResolvedValue('fm2_old');
      const source = flyctlTokenSource('fm2_old', { runFlyctl, readStoredToken, now: () => 0 });

      const result = await source.refresh?.('fm2_old');

      expect(result).toBeNull();
      expect(readStoredToken).not.toHaveBeenCalled();
    });

    it('when flyctl fails, a changed stored token is returned', async () => {
      const runFlyctl = vi.fn().mockRejectedValue(new Error('flyctl not found'));
      const readStoredToken = vi.fn().mockResolvedValue('fm2_from_file');
      const source = flyctlTokenSource('fm2_old', { runFlyctl, readStoredToken, now: () => 0 });

      const result = await source.refresh?.('fm2_old');

      expect(result).toBe('fm2_from_file');
      await expect(source.current()).resolves.toBe('fm2_from_file');
    });
  });

  describe('staticFlyTokenSource', () => {
    it('has no refresh and origin explicit', async () => {
      const source = staticFlyTokenSource('fm2_static');

      expect(source.origin).toBe('explicit');
      expect(source.refresh).toBeUndefined();
      await expect(source.current()).resolves.toBe('fm2_static');
    });
  });
});
