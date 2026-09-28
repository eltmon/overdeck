/** PAN-4264 Work Item 24: instance_heartbeat at most once per 24 hours. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { INSTANCE_HEARTBEAT_INTERVAL_MS, maybeSendInstanceHeartbeat } from '../../../../src/lib/telemetry/instance-heartbeat.js';

describe('instance heartbeat (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 27, 15, 0));
    home = mkdtempSync(join(tmpdir(), 'pan-heartbeat-'));
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  function send(analytics: { capture: ReturnType<typeof vi.fn> }, dashboardRunning = true) {
    return maybeSendInstanceHeartbeat({
      dashboardRunning,
      listProjects: () => [1, 2, 3],
      listAgents: async () => [{ hasLivePane: true }, { hasLivePane: false }],
      analytics,
    });
  }

  it('sends the first call, not a second within 24 hours, and again at +24 hours', async () => {
    const analytics = { capture: vi.fn() };

    expect(await send(analytics)).toBe(true);
    await vi.advanceTimersByTimeAsync(INSTANCE_HEARTBEAT_INTERVAL_MS - 60_000);
    expect(await send(analytics, false)).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await send(analytics, false)).toBe(true);

    expect(analytics.capture.mock.calls).toEqual([
      ['instance_heartbeat', { project_count: '3-5', active_agent_count: '1-2', dashboard_running: true }],
      ['instance_heartbeat', { project_count: '3-5', active_agent_count: '1-2', dashboard_running: false }],
    ]);
    const stored = JSON.parse(readFileSync(join(home, 'telemetry-heartbeat.json'), 'utf8'));
    expect(stored).toEqual({ lastSentAt: new Date(Date.now()).toISOString() });
  });

  it('reports a zero agent count from the CLI', async () => {
    const analytics = { capture: vi.fn() };
    await maybeSendInstanceHeartbeat({ dashboardRunning: false, listProjects: () => [], listAgents: () => [], analytics });
    expect(analytics.capture).toHaveBeenCalledWith('instance_heartbeat', {
      project_count: '0', active_agent_count: '0', dashboard_running: false,
    });
  });
});
