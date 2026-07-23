import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnalyticsService,
  getAnalyticsService,
  shutdownAnalyticsServices,
  trackAnalyticsTask,
} from '../../../../src/lib/telemetry/service.js';
import { CliTelemetryLifecycle } from '../../../../src/cli/telemetry.js';
import { capturePipelineStage } from '../../../../src/lib/telemetry/pipeline.js';
import { resolveTelemetryEnabled } from '../../../../src/lib/telemetry/config.js';

const captureMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const isFeatureEnabledMock = vi.hoisted(() => vi.fn());
const shutdownMock = vi.hoisted(() => vi.fn());
const postHogConstructorMock = vi.hoisted(() => vi.fn(function PostHogMock() {
  return {
    capture: captureMock,
    captureException: captureExceptionMock,
    isFeatureEnabled: isFeatureEnabledMock,
    shutdown: shutdownMock,
  };
}));

vi.mock('posthog-node', () => ({ PostHog: postHogConstructorMock }));
vi.mock('../../../../src/lib/telemetry/config.js', () => ({
  resolveTelemetryEnabled: vi.fn(),
}));
vi.mock('../../../../src/lib/telemetry/install-id.js', () => ({
  getOrCreateInstallId: vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'),
}));

const originalVitest = process.env.VITEST;
const originalNodeEnv = process.env.NODE_ENV;
const originalExitCode = process.exitCode;

function allowTelemetryInTestProcess(): void {
  delete process.env.VITEST;
  delete process.env.NODE_ENV;
}

describe('AnalyticsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    allowTelemetryInTestProcess();
    vi.mocked(resolveTelemetryEnabled).mockReturnValue(true);
    shutdownMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = originalVitest;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    process.exitCode = originalExitCode;
  });

  it('never constructs the client when telemetry is disabled', async () => {
    vi.mocked(resolveTelemetryEnabled).mockReturnValue(false);
    const analytics = new AnalyticsService('server');

    analytics.capture('server_boot', { project_count: '0', active_agent_count: '0' });
    await analytics.shutdown();

    expect(postHogConstructorMock).not.toHaveBeenCalled();
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('never constructs the client in a Vitest process', () => {
    process.env.VITEST = 'true';
    const analytics = new AnalyticsService('cli');

    analytics.capture('project_created', { mode: 'new' });

    expect(postHogConstructorMock).not.toHaveBeenCalled();
  });

  it('captures typed events with anonymous runtime metadata', () => {
    const analytics = new AnalyticsService('server');

    analytics.capture('server_boot', { project_count: '1-2', active_agent_count: '3-5' });

    expect(postHogConstructorMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      host: 'https://us.i.posthog.com',
      enableExceptionAutocapture: false,
    }));
    expect(captureMock).toHaveBeenCalledWith({
      distinctId: '123e4567-e89b-42d3-a456-426614174000',
      event: 'server_boot',
      properties: expect.objectContaining({
        project_count: '1-2',
        active_agent_count: '3-5',
        $process_person_profile: false,
        platform: process.platform,
        arch: process.arch,
        overdeckVersion: expect.any(String),
        clientType: 'server',
      }),
    });
  });

  it('flushes CLI-owned pipeline events through the shared CLI client', async () => {
    capturePipelineStage('work_done', {
      harness: 'claude-code',
      model: 'claude',
    });
    const telemetry = new CliTelemetryLifecycle(undefined, 0);

    await telemetry.finish(true, ['node', 'pan', 'done'], 50);

    expect(captureMock).toHaveBeenCalledWith(expect.objectContaining({
      event: 'pipeline_stage_changed',
      properties: expect.objectContaining({
        stage: 'work_done',
        clientType: 'cli',
      }),
    }));
    expect(shutdownMock).toHaveBeenCalledTimes(1);
  });

  it('waits for pending analytics work before flushing shared clients', async () => {
    let finishPending: (() => void) | undefined;
    trackAnalyticsTask(new Promise<void>((resolve) => {
      finishPending = resolve;
    }));
    const telemetry = new CliTelemetryLifecycle(undefined, 0);

    const finish = telemetry.finish(true, ['node', 'pan', 'done'], 50);
    await Promise.resolve();

    expect(shutdownMock).not.toHaveBeenCalled();
    finishPending?.();
    await finish;
    expect(shutdownMock).toHaveBeenCalledTimes(1);
  });

  it('removes private messages and stack frames from captured exceptions', () => {
    const analytics = new AnalyticsService('server');
    const original = new Error(
      'PAN-2599 failed in /home/alice/private-repo on feature/secret with token ghp_secret',
    );

    analytics.captureException(original, { action: 'pipeline_transition' });

    const [sanitized, distinctId, properties] = captureExceptionMock.mock.calls[0]!;
    expect(sanitized).toBeInstanceOf(Error);
    expect(sanitized).toMatchObject({
      name: 'OverdeckTelemetryException',
      message: 'Overdeck pipeline_transition operation failed',
      stack: undefined,
    });
    expect(distinctId).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(properties).toEqual(expect.objectContaining({
      action: 'pipeline_transition',
      $process_person_profile: false,
      clientType: 'server',
    }));
    expect(JSON.stringify([sanitized, properties])).not.toContain('PAN-2599');
    expect(JSON.stringify([sanitized, properties])).not.toContain('/home/alice');
    expect(JSON.stringify([sanitized, properties])).not.toContain('ghp_secret');
  });

  it.each([
    ['uncaughtException', 'uncaught_exception'],
    ['unhandledRejection', 'unhandled_rejection'],
  ] as const)('captures %s, flushes, and exits nonzero', async (event, action) => {
    const onSpy = vi.spyOn(process, 'on');
    const offSpy = vi.spyOn(process, 'off');
    const fatalExit = vi.fn() as unknown as (code: number) => never;
    const analytics = new AnalyticsService('server', {
      captureProcessExceptions: true,
      fatalProcessExit: fatalExit,
    });

    analytics.capture('server_boot', { project_count: '0', active_agent_count: '0' });
    const handler = onSpy.mock.calls.find(([registered]) => registered === event)?.[1] as
      | ((error: Error) => void)
      | undefined;
    expect(handler).toBeTypeOf('function');
    captureExceptionMock.mockClear();
    shutdownMock.mockClear();

    handler?.(new Error('PAN-2599 /home/alice/private-repo ghp_secret'));
    await vi.runAllTimersAsync();

    expect(captureExceptionMock).toHaveBeenCalledOnce();
    expect(captureExceptionMock.mock.calls[0]?.[0]).toMatchObject({
      message: `Overdeck ${action} operation failed`,
      stack: undefined,
    });
    expect(JSON.stringify(captureExceptionMock.mock.calls)).not.toContain('PAN-2599');
    expect(JSON.stringify(captureExceptionMock.mock.calls)).not.toContain('/home/alice');
    expect(JSON.stringify(captureExceptionMock.mock.calls)).not.toContain('ghp_secret');
    expect(shutdownMock).toHaveBeenCalledOnce();
    expect(fatalExit).toHaveBeenCalledWith(1);
    expect(process.exitCode).toBe(1);
    expect(offSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    expect(offSpy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    onSpy.mockRestore();
    offSpy.mockRestore();
  });

  it('bounds fatal exception flushing before nonzero exit', async () => {
    const onSpy = vi.spyOn(process, 'on');
    const fatalExit = vi.fn() as unknown as (code: number) => never;
    shutdownMock.mockReturnValue(new Promise<void>(() => undefined));
    const analytics = new AnalyticsService('server', {
      captureProcessExceptions: true,
      fatalProcessExit: fatalExit,
    });
    analytics.capture('server_boot', { project_count: '0', active_agent_count: '0' });
    const handler = onSpy.mock.calls.find(([event]) => event === 'uncaughtException')?.[1] as
      | ((error: Error) => void)
      | undefined;

    handler?.(new Error('private fatal error'));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fatalExit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fatalExit).toHaveBeenCalledWith(1);
    onSpy.mockRestore();
  });

  it('stops using an existing client when telemetry becomes disabled', async () => {
    const analytics = new AnalyticsService('server');
    analytics.capture('server_boot', { project_count: '0', active_agent_count: '0' });
    vi.clearAllMocks();
    shutdownMock.mockResolvedValue(undefined);
    vi.mocked(resolveTelemetryEnabled).mockReturnValue(false);

    analytics.capture('project_created', { mode: 'new' });
    analytics.captureException(new Error('private'), { action: 'server_boot' });
    await expect(analytics.isFeatureEnabled('test-flag', false)).resolves.toBe(false);
    await vi.runAllTimersAsync();

    expect(captureMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(isFeatureEnabledMock).not.toHaveBeenCalled();
    expect(shutdownMock).toHaveBeenCalledTimes(1);
  });

  it('does not leak capture failures into the caller', () => {
    captureMock.mockImplementationOnce(() => { throw new Error('network failure'); });
    const analytics = new AnalyticsService('server');

    expect(() => analytics.capture('project_created', { mode: 'new' })).not.toThrow();
  });

  it('clears the timeout when shutdown flushes immediately', async () => {
    const analytics = new AnalyticsService('cli');
    analytics.capture('project_created', { mode: 'existing' });

    await analytics.shutdown();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps pending work plus client shutdown at two seconds total', async () => {
    shutdownMock.mockReturnValue(new Promise<void>(() => undefined));
    const analytics = getAnalyticsService('cli');
    analytics.capture('project_created', { mode: 'existing' });
    let finishPending: (() => void) | undefined;
    trackAnalyticsTask(new Promise<void>((resolve) => {
      finishPending = resolve;
    }));

    const shutdownPromise = shutdownAnalyticsServices();
    let settled = false;
    void shutdownPromise.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await shutdownPromise;
    expect(settled).toBe(true);
    finishPending?.();
    await Promise.resolve();
  });

  it('bounds a hung shutdown flush at two seconds', async () => {
    shutdownMock.mockReturnValue(new Promise<void>(() => undefined));
    const analytics = new AnalyticsService('cli');
    analytics.capture('project_created', { mode: 'existing' });

    const shutdownPromise = analytics.shutdown();
    let settled = false;
    void shutdownPromise.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await shutdownPromise;
    expect(settled).toBe(true);
  });
});
