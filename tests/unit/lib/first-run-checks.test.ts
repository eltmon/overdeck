/**
 * Unit tests for src/lib/first-run-checks.ts (PAN-4282 item A).
 *
 * `gh auth status` is exercised through a mocked `node:child_process.execFile`
 * (callback style, matching how `promisify` wraps it). The 60 s memo is
 * exercised with fake timers around `Date.now()` only — `execFile` resolves
 * synchronously via the mock, never a real delay.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';

const mockExecFile = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: unknown, result?: unknown) => void;
    const file = args[0] as string;
    const cmdArgs = args[1] as string[];
    const result = mockExecFile(file, cmdArgs);
    Promise.resolve(result).then(
      (val) => cb(null, val),
      (err) => cb(err),
    );
    return {};
  },
}));

const mockGetClaudeAuthStatus = vi.fn();

vi.mock('../../../src/lib/claude-auth.js', () => ({
  getClaudeAuthStatus: () => mockGetClaudeAuthStatus(),
}));

const mockHostTerminalBackendName = vi.fn();
const mockProbeHerdrAvailability = vi.fn();

vi.mock('../../../src/lib/terminal-backends/select.js', () => ({
  hostTerminalBackendName: () => mockHostTerminalBackendName(),
  probeHerdrAvailability: () => mockProbeHerdrAvailability(),
}));

import {
  checkClaudeLogin,
  checkGhLogin,
  checkHostBackend,
  resetFirstRunCheckMemo,
} from '../../../src/lib/first-run-checks.js';

function claudeStatus(overrides: Partial<{
  installed: boolean;
  loggedIn: boolean;
  expired: boolean;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  expiresAt: number | null;
  hasAnthropicApiKey: boolean;
}> = {}) {
  return {
    installed: true,
    loggedIn: false,
    expired: false,
    subscriptionType: null,
    rateLimitTier: null,
    expiresAt: null,
    hasAnthropicApiKey: false,
    ...overrides,
  };
}

describe('first-run-checks', () => {
  beforeEach(() => {
    resetFirstRunCheckMemo();
    mockExecFile.mockReset();
    mockGetClaudeAuthStatus.mockReset();
    mockHostTerminalBackendName.mockReset();
    mockProbeHerdrAvailability.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkGhLogin', () => {
    it('resolves ok when gh auth status exits 0', async () => {
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
      const result = await checkGhLogin();
      expect(result).toEqual({ installed: true, ok: true });
    });

    it('reports installed but not ok on a non-zero exit', async () => {
      mockExecFile.mockRejectedValue(Object.assign(new Error('exit 1'), { code: 1 }));
      const result = await checkGhLogin();
      expect(result).toEqual({ installed: true, ok: false });
    });

    it('reports not installed on ENOENT', async () => {
      mockExecFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      const result = await checkGhLogin();
      expect(result).toEqual({ installed: false, ok: false });
    });

    it('memoizes for 60s, then re-probes; force bypasses the memo', async () => {
      vi.useFakeTimers();
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await checkGhLogin();
      await checkGhLogin();
      expect(mockExecFile).toHaveBeenCalledTimes(1);

      await checkGhLogin({ force: true });
      expect(mockExecFile).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(60_001);
      await checkGhLogin();
      expect(mockExecFile).toHaveBeenCalledTimes(3);
    });
  });

  describe('checkClaudeLogin', () => {
    it('is ok when logged in and not expired', async () => {
      mockGetClaudeAuthStatus.mockReturnValue(
        Effect.succeed(claudeStatus({ loggedIn: true, expired: false, subscriptionType: 'max' })),
      );
      const result = await checkClaudeLogin();
      expect(result).toEqual({ ok: true, detail: 'Signed in (max)' });
    });

    it('is not ok when expired without an API key', async () => {
      mockGetClaudeAuthStatus.mockReturnValue(
        Effect.succeed(claudeStatus({ loggedIn: true, expired: true })),
      );
      const result = await checkClaudeLogin();
      expect(result.ok).toBe(false);
      expect(result.detail).toBe('Sign-in expired');
    });

    it('is ok when only an API key is set', async () => {
      mockGetClaudeAuthStatus.mockReturnValue(
        Effect.succeed(claudeStatus({ hasAnthropicApiKey: true })),
      );
      const result = await checkClaudeLogin();
      expect(result).toEqual({ ok: true, detail: 'Using ANTHROPIC_API_KEY' });
    });
  });

  describe('checkHostBackend', () => {
    it('copies available and reason from probeHerdrAvailability under herdr', async () => {
      mockHostTerminalBackendName.mockResolvedValue('herdr');
      mockProbeHerdrAvailability.mockResolvedValue({
        binary: '/usr/local/bin/herdr',
        session: 'overdeck',
        socket: '/tmp/herdr.sock',
        socketExists: false,
        available: false,
        reason: "the 'herdr' session socket does not exist.",
      });
      const result = await checkHostBackend();
      expect(result).toEqual({
        name: 'herdr',
        available: false,
        reason: "the 'herdr' session socket does not exist.",
      });
    });

    it('trusts options.tmuxFound under tmux', async () => {
      mockHostTerminalBackendName.mockResolvedValue('tmux');
      const missing = await checkHostBackend({ tmuxFound: false, force: true });
      expect(missing).toEqual({ name: 'tmux', available: false, reason: 'tmux is not installed.' });

      const found = await checkHostBackend({ tmuxFound: true, force: true });
      expect(found).toEqual({ name: 'tmux', available: true, reason: null });
    });
  });
});
