import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from '../../../src/lib/telemetry/service.js';
import {
  exitCli as exitThroughDoor,
  registerCliExitFinalizer,
} from '../../../src/cli/exit.js';
import {
  bucketCliDuration,
  CliProcessLifecycle,
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
    registerCliExitFinalizer(async () => undefined);
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

  it('runs the registered finalizer before the lightweight exit door', async () => {
    const finalize = vi.fn(() => new Promise<void>((resolve) => {
      setTimeout(resolve, 2_000);
    }));
    registerCliExitFinalizer(finalize);
    const exitError = new Error('process exited');
    const exit = vi.fn((): never => { throw exitError; });

    const result = exitThroughDoor(7, exit).catch((error) => error);

    expect(finalize).toHaveBeenCalledWith(7);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await result).toBe(exitError);
    expect(exit).toHaveBeenCalledWith(7);
  });

  it('drains journal and state writes before telemetry and native exit', async () => {
    let finishJournal: (() => void) | undefined;
    let finishState: (() => void) | undefined;
    let finishTelemetry: (() => void) | undefined;
    const journal = new Promise<void>((resolve) => { finishJournal = resolve; });
    const state = new Promise<void>((resolve) => { finishState = resolve; });
    const telemetry = new Promise<void>((resolve) => { finishTelemetry = resolve; });
    const drain = vi.fn(async () => {
      await journal;
      await state;
    });
    const finish = vi.fn(() => telemetry);
    const lifecycle = new CliProcessLifecycle({ finish }, drain);
    registerCliExitFinalizer((code) => lifecycle.finish(code === 0));
    const exitError = new Error('process exited');
    const exit = vi.fn((): never => { throw exitError; });

    const result = exitThroughDoor(0, exit).catch((error) => error);
    expect(drain).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    finishJournal?.();
    await Promise.resolve();
    expect(finish).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    finishState?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(finish).toHaveBeenCalledWith(true);
    expect(exit).not.toHaveBeenCalled();

    finishTelemetry?.();
    expect(await result).toBe(exitError);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('flushes a child-process callback exit through the explicit async door', async () => {
    const analytics = {
      capture: vi.fn(),
      shutdown: vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 2_000))),
    } as unknown as Pick<AnalyticsService, 'capture' | 'shutdown'>;
    const telemetry = new CliTelemetryLifecycle(analytics, 0);
    const exitError = new Error('process exited');
    const exit = vi.fn((): never => { throw exitError; });
    const child = new EventEmitter();
    let pendingExit: Promise<unknown> | undefined;
    child.once('exit', (code: number) => {
      pendingExit = exitAfterTelemetry(code, telemetry, exit).catch((error) => error);
    });

    child.emit('exit', 7);

    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pendingExit).toBe(exitError);
    expect(exit).toHaveBeenCalledWith(7);
    expect(analytics.capture).toHaveBeenCalledWith(
      'cli_command_run',
      expect.objectContaining({ ok: false }),
    );
  });

  it('flushes a SIGINT exit and shares an in-flight finalization', async () => {
    const analytics = {
      capture: vi.fn(),
      shutdown: vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 2_000))),
    } as unknown as Pick<AnalyticsService, 'capture' | 'shutdown'>;
    const telemetry = new CliTelemetryLifecycle(analytics, 0);
    const exitError = new Error('process exited');
    const exit = vi.fn((): never => { throw exitError; });
    const signals = new EventEmitter();
    let pendingExit: Promise<unknown> | undefined;
    signals.once('SIGINT', () => {
      pendingExit = exitAfterTelemetry(130, telemetry, exit).catch((error) => error);
    });

    signals.emit('SIGINT');
    const duplicateFinish = telemetry.finish(false);

    await vi.advanceTimersByTimeAsync(2_000);
    await duplicateFinish;
    expect(await pendingExit).toBe(exitError);
    expect(exit).toHaveBeenCalledWith(130);
    expect(analytics.capture).toHaveBeenCalledTimes(1);
    expect(analytics.shutdown).toHaveBeenCalledTimes(1);
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
