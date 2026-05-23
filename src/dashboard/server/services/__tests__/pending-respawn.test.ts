import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock tmux.sessionExists — pending-respawn polls it. Each test resets
// the mock's implementation so cases are independent.
vi.mock('../../../../lib/tmux.js', () => ({
  sessionExists: vi.fn(),
  sessionExistsSync: vi.fn(),
}));

import { sessionExists } from '../../../../lib/tmux.js';
import {
  isRespawnPending,
  markRespawnPending,
  waitForSessionRespawn,
} from '../pending-respawn.js';

const mockedSessionExists = vi.mocked(sessionExists);

describe('pending-respawn registry', () => {
  beforeEach(() => {
    mockedSessionExists.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Defensive: nothing should be left marked between tests.
    expect(isRespawnPending('test-session')).toBe(false);
    expect(isRespawnPending('other-session')).toBe(false);
  });

  it('marks and clears via the returned done()', () => {
    expect(isRespawnPending('test-session')).toBe(false);
    const respawn = markRespawnPending('test-session');
    expect(isRespawnPending('test-session')).toBe(true);
    respawn.done();
    expect(isRespawnPending('test-session')).toBe(false);
  });

  it('marker is scoped per session name', () => {
    const a = markRespawnPending('test-session');
    expect(isRespawnPending('test-session')).toBe(true);
    expect(isRespawnPending('other-session')).toBe(false);
    a.done();
  });

  it('waitForSessionRespawn resolves true once the session appears', async () => {
    vi.useFakeTimers();
    mockedSessionExists
      .mockReturnValueOnce(Effect.succeed(false))
      .mockReturnValueOnce(Effect.succeed(false))
      .mockReturnValueOnce(Effect.succeed(true));

    const respawn = markRespawnPending('test-session');
    const resultPromise = waitForSessionRespawn('test-session', 5000);
    await vi.advanceTimersByTimeAsync(400);

    await expect(resultPromise).resolves.toBe(true);
    respawn.done();
  });

  it('bails early once the marker clears and the session still does not exist', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const respawn = markRespawnPending('test-session');
    mockedSessionExists.mockImplementation(() => Effect.sync(() => {
      calls += 1;
      if (calls === 2) respawn.done();
      return false;
    }));

    const resultPromise = waitForSessionRespawn('test-session', 5000);
    await vi.advanceTimersByTimeAsync(200);

    await expect(resultPromise).resolves.toBe(false);
    expect(mockedSessionExists.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('honors the timeout when the session never appears', async () => {
    vi.useFakeTimers();
    mockedSessionExists.mockReturnValue(Effect.succeed(false));
    const respawn = markRespawnPending('test-session');
    const resultPromise = waitForSessionRespawn('test-session', 300);

    await vi.advanceTimersByTimeAsync(400);

    await expect(resultPromise).resolves.toBe(false);
    respawn.done();
  });

  it('returns true immediately if the session already exists when called', async () => {
    mockedSessionExists.mockReturnValueOnce(Effect.succeed(true));
    const respawn = markRespawnPending('test-session');
    const result = await waitForSessionRespawn('test-session', 5000);
    expect(result).toBe(true);
    expect(mockedSessionExists).toHaveBeenCalledTimes(1);
    respawn.done();
  });

  it('checks sessionExists even when no marker is set', async () => {
    mockedSessionExists.mockReturnValueOnce(Effect.succeed(true));
    const result = await waitForSessionRespawn('test-session', 5000);
    expect(result).toBe(true);
    expect(mockedSessionExists).toHaveBeenCalledTimes(1);
  });
});
