import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from '../../../../src/lib/telemetry/service.js';
import { resolveTelemetryEnabled } from '../../../../src/lib/telemetry/config.js';

const captureMock = vi.hoisted(() => vi.fn());
const shutdownMock = vi.hoisted(() => vi.fn());
const postHogConstructorMock = vi.hoisted(() => vi.fn(function PostHogMock() {
  return {
    capture: captureMock,
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
      enableExceptionAutocapture: true,
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
