import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => {
  const capture = vi.fn();
  const shutdown = vi.fn(async () => undefined);
  return {
    capture,
    shutdown,
    getAnalyticsService: vi.fn(() => ({ capture, shutdown })),
    shutdownAnalyticsServices: vi.fn(async () => undefined),
    setAnalyticsClientTypeForProcess: vi.fn(),
    trackAnalyticsTask: vi.fn((task: Promise<unknown>) => task),
  };
});
const heartbeatMocks = vi.hoisted(() => ({ maybeSendInstanceHeartbeat: vi.fn(async () => undefined) }));
const ledgerMocks = vi.hoisted(() => ({ flushLedgerWrites: vi.fn(async () => undefined) }));

vi.mock('../../../src/lib/telemetry/service.js', () => ({
  AnalyticsService: class {},
  getAnalyticsService: serviceMocks.getAnalyticsService,
  shutdownAnalyticsServices: serviceMocks.shutdownAnalyticsServices,
  setAnalyticsClientTypeForProcess: serviceMocks.setAnalyticsClientTypeForProcess,
  trackAnalyticsTask: serviceMocks.trackAnalyticsTask,
}));
vi.mock('../../../src/lib/telemetry/instance-heartbeat.js', () => heartbeatMocks);
vi.mock('../../../src/lib/telemetry/github-quota-telemetry.js', () => ({ registerGitHubRateLimitedTelemetry: vi.fn() }));
vi.mock('../../../src/lib/github-quota/ledger.js', () => ledgerMocks);
vi.mock('../../../src/lib/projects.js', () => ({ listProjectsSync: () => [] }));

import { registerCliExitFinalizer } from '../../../src/cli/exit.js';
import { isVaultInvocation, runCliWithTelemetry } from '../../../src/cli/telemetry.js';

describe('pan vault telemetry bypass (P-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    registerCliExitFinalizer(async () => undefined);
  });

  it('recognises the vault group from the first positional argv only', () => {
    expect(isVaultInvocation(['node', 'pan', 'vault', 'status'])).toBe(true);
    expect(isVaultInvocation(['node', 'pan', 'vault'])).toBe(true);
    expect(isVaultInvocation(['node', 'pan', 'status'])).toBe(false);
    expect(isVaultInvocation(['node', 'pan', 'start', 'vault'])).toBe(false);
    expect(isVaultInvocation(['node', 'pan'])).toBe(false);
  });

  it('importing the module creates no analytics client', () => {
    expect(serviceMocks.getAnalyticsService).not.toHaveBeenCalled();
  });

  it('ac1: pan vault runs without analytics or the instance heartbeat', async () => {
    const run = vi.fn(async () => undefined);
    const drain = vi.fn(async () => undefined);

    await runCliWithTelemetry(run, drain, ['node', 'pan', 'vault', 'status']);

    expect(run).toHaveBeenCalledOnce();
    expect(drain).toHaveBeenCalledOnce();
    expect(serviceMocks.getAnalyticsService).not.toHaveBeenCalled();
    expect(heartbeatMocks.maybeSendInstanceHeartbeat).not.toHaveBeenCalled();
    expect(serviceMocks.capture).not.toHaveBeenCalled();
    expect(serviceMocks.shutdownAnalyticsServices).not.toHaveBeenCalled();
    expect(ledgerMocks.flushLedgerWrites).toHaveBeenCalledOnce();
  });

  it('ac2: other verbs keep the telemetry lifecycle and capture completion', async () => {
    const run = vi.fn(async () => undefined);
    const drain = vi.fn(async () => undefined);

    await runCliWithTelemetry(run, drain, ['node', 'pan', 'status']);

    expect(serviceMocks.getAnalyticsService).toHaveBeenCalledWith('cli');
    // The lifecycle reads the verb from process.argv (vitest's here), so only
    // the event name and outcome are pinned.
    expect(serviceMocks.capture).toHaveBeenCalledTimes(1);
    expect(serviceMocks.capture).toHaveBeenCalledWith(
      'cli_command_run',
      expect.objectContaining({ ok: true }),
    );
    // The heartbeat is tracked, not awaited, behind a dynamic import.
    await vi.waitFor(() => expect(heartbeatMocks.maybeSendInstanceHeartbeat).toHaveBeenCalledOnce());
    expect(serviceMocks.shutdownAnalyticsServices).toHaveBeenCalledOnce();
    expect(ledgerMocks.flushLedgerWrites).toHaveBeenCalledOnce();
  });
});
