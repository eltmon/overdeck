/** PAN-4650 WI-17: a forward never reaches Overdeck's own ports or a port outside 1024-65535. */
import { describe, expect, it } from 'vitest';

import { readPlatformConfig } from '../../../lib/platform-lifecycle.js';
import { getSupervisorPort } from '../../../lib/supervisor.js';
import { isForwardablePort, refusedForwardPorts } from '../forward-ports.js';

describe('forwardable ports (PAN-4650 D-4650-16)', () => {
  it("refuses this machine's dashboard, API, supervisor and Traefik ports", async () => {
    const refused = await refusedForwardPorts();
    const platform = readPlatformConfig();
    for (const port of [platform.dashboardPort, platform.dashboardApiPort, getSupervisorPort(), 80, 443]) {
      expect(refused.has(port), String(port)).toBe(true);
      expect(isForwardablePort(port, refused)).toBe(false);
    }
    expect(getSupervisorPort()).toBe(platform.dashboardApiPort + 1);
  });

  it('refuses ports outside 1024-65535 and non-integers; allows an ordinary dev port', () => {
    const refused = new Set([3011]);
    expect(isForwardablePort(1023, refused)).toBe(false);
    expect(isForwardablePort(80000, refused)).toBe(false);
    expect(isForwardablePort(5173.5, refused)).toBe(false);
    expect(isForwardablePort(Number.NaN, refused)).toBe(false);
    expect(isForwardablePort(3011, refused)).toBe(false);
    expect(isForwardablePort(5173, refused)).toBe(true);
    expect(isForwardablePort(65535, refused)).toBe(true);
  });
});
