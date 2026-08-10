import { describe, expect, it, vi } from 'vitest';
import { startCliproxyWatchdogForDashboard } from '../../../../../src/dashboard/server/routes/cliproxy.js';

describe('startCliproxyWatchdogForDashboard', () => {
  it('does not start the host-only watchdog in a peer dashboard', () => {
    const startWatchdog = vi.fn();

    expect(startCliproxyWatchdogForDashboard(true, startWatchdog)).toBe(false);
    expect(startWatchdog).not.toHaveBeenCalled();
  });

  it('starts the watchdog once in the host dashboard', () => {
    const startWatchdog = vi.fn();

    expect(startCliproxyWatchdogForDashboard(false, startWatchdog)).toBe(true);
    expect(startWatchdog).toHaveBeenCalledOnce();
  });
});
