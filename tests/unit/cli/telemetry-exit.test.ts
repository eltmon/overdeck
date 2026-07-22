import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from '../../../src/lib/telemetry/service.js';
import {
  bucketCliDuration,
  CliTelemetryLifecycle,
  exitAfterTelemetry,
  resolveTelemetryCliVerb,
} from '../../../src/cli/telemetry.js';

const captureMock = vi.hoisted(() => vi.fn());
const shutdownMock = vi.hoisted(() => vi.fn());
const postHogConstructorMock = vi.hoisted(() => vi.fn(function PostHogMock() {
  return {
    capture: captureMock,
    shutdown: shutdownMock,
  };
}));

vi.mock('posthog-node', () => ({ PostHog: postHogConstructorMock }));

describe('CLI telemetry lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('buckets durations without reporting raw timing', () => {
    expect(bucketCliDuration(99)).toBe('under_100ms');
    expect(bucketCliDuration(100)).toBe('100ms-999ms');
    expect(bucketCliDuration(1_000)).toBe('1s-9s');
    expect(bucketCliDuration(10_000)).toBe('10s+');
  });

  it('uses an allowlisted top-level verb or other', () => {
    expect(resolveTelemetryCliVerb(['node', 'pan', 'start', 'PAN-2599'])).toBe('start');
    expect(resolveTelemetryCliVerb(['node', 'pan', 'private-command'])).toBe('other');
  });

  it('captures completion and awaits shutdown before exiting', async () => {
    const analytics = {
      capture: vi.fn(),
      shutdown: vi.fn(() => new Promise<void>((resolve) => {
        setTimeout(resolve, 2_000);
      })),
    } as unknown as Pick<AnalyticsService, 'capture' | 'shutdown'>;
    const telemetry = new CliTelemetryLifecycle(analytics, 0);
    const exitError = new Error('process exited');
    const exit = vi.fn((): never => { throw exitError; });

    const exitResult = exitAfterTelemetry(1, telemetry, exit).catch((error) => error);

    expect(analytics.capture).toHaveBeenCalledWith('cli_command_run', {
      verb: 'other',
      ok: false,
      duration_ms: 'under_100ms',
    });
    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_999);
    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(await exitResult).toBe(exitError);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits immediately without SDK capture when telemetry is test-disabled', async () => {
    const telemetry = new CliTelemetryLifecycle(new AnalyticsService('cli'), 0);
    const exitError = new Error('process exited');
    const exit = vi.fn((): never => { throw exitError; });

    await expect(exitAfterTelemetry(0, telemetry, exit)).rejects.toBe(exitError);

    expect(postHogConstructorMock).not.toHaveBeenCalled();
    expect(captureMock).not.toHaveBeenCalled();
    expect(shutdownMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
