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

    // A mock routing controller keeps this test off the real CLIProxy.
    expect(startCliproxyWatchdogForDashboard(false, startWatchdog, vi.fn())).toBe(true);
    expect(startWatchdog).toHaveBeenCalledOnce();
  });

  it('peer dashboards start neither the watchdog nor the routing controller', () => {
    const startWatchdog = vi.fn();
    const startRouting = vi.fn();

    expect(startCliproxyWatchdogForDashboard(true, startWatchdog, startRouting)).toBe(false);
    expect(startWatchdog).not.toHaveBeenCalled();
    expect(startRouting).not.toHaveBeenCalled();
  });

  it('host dashboards start the watchdog and the routing controller once each', () => {
    const startWatchdog = vi.fn();
    const startRouting = vi.fn();

    expect(startCliproxyWatchdogForDashboard(false, startWatchdog, startRouting)).toBe(true);
    expect(startWatchdog).toHaveBeenCalledOnce();
    expect(startRouting).toHaveBeenCalledOnce();
  });
});
