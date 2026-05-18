import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock tmux.sessionExistsAsync — pending-respawn polls it. Each test resets
// the mock's implementation so cases are independent.
vi.mock('../../../../lib/tmux.js', () => ({
  sessionExistsAsync: vi.fn(),
}));

import { sessionExistsAsync } from '../../../../lib/tmux.js';
import {
  isRespawnPending,
  markRespawnPending,
  waitForSessionRespawn,
} from '../pending-respawn.js';

const mockedSessionExistsAsync = vi.mocked(sessionExistsAsync);

describe('pending-respawn registry', () => {
  beforeEach(() => {
    mockedSessionExistsAsync.mockReset();
  });

  afterEach(() => {
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
    mockedSessionExistsAsync
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const respawn = markRespawnPending('test-session');
    const result = await waitForSessionRespawn('test-session', 5000);
    expect(result).toBe(true);
    respawn.done();
  });

  it('bails early once the marker clears and the session still does not exist', async () => {
    mockedSessionExistsAsync.mockResolvedValue(false);

    const respawn = markRespawnPending('test-session');
    // Clear the marker after the first poll round so the next iteration
    // takes the early-exit path. The bail check itself does one more
    // sessionExistsAsync to handle "respawn just cleared and may have
    // succeeded" — we want the final result here to be false (no session).
    setTimeout(() => respawn.done(), 50);

    const result = await waitForSessionRespawn('test-session', 5000);
    expect(result).toBe(false);
    // Bail path performs at least one initial check and one final check.
    expect(mockedSessionExistsAsync.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('honors the timeout when the session never appears', async () => {
    mockedSessionExistsAsync.mockResolvedValue(false);
    const respawn = markRespawnPending('test-session');
    const start = Date.now();
    const result = await waitForSessionRespawn('test-session', 300);
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(1500);
    respawn.done();
  });

  it('returns true immediately if the session already exists when called', async () => {
    mockedSessionExistsAsync.mockResolvedValueOnce(true);
    const respawn = markRespawnPending('test-session');
    const result = await waitForSessionRespawn('test-session', 5000);
    expect(result).toBe(true);
    expect(mockedSessionExistsAsync).toHaveBeenCalledTimes(1);
    respawn.done();
  });

  it('checks sessionExistsAsync even when no marker is set', async () => {
    mockedSessionExistsAsync.mockResolvedValueOnce(true);
    const result = await waitForSessionRespawn('test-session', 5000);
    expect(result).toBe(true);
    expect(mockedSessionExistsAsync).toHaveBeenCalledTimes(1);
  });
});
