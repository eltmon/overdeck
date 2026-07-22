import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from '../../../../src/lib/telemetry/service.js';
import { resolveTelemetryEnabled } from '../../../../src/lib/telemetry/config.js';

const isFeatureEnabledMock = vi.hoisted(() => vi.fn());
const postHogConstructorMock = vi.hoisted(() => vi.fn(function PostHogMock() {
  return {
    capture: vi.fn(),
    isFeatureEnabled: isFeatureEnabledMock,
    shutdown: vi.fn(),
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

describe('AnalyticsService feature flag door', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    delete process.env.VITEST;
    delete process.env.NODE_ENV;
    vi.mocked(resolveTelemetryEnabled).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = originalVitest;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns the fallback after a hung evaluation reaches 500ms', async () => {
    isFeatureEnabledMock.mockReturnValue(new Promise<boolean>(() => undefined));
    const analytics = new AnalyticsService('server');

    const resultPromise = analytics.isFeatureEnabled('new-dashboard', true);
    let settled = false;
    void resultPromise.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toBe(true);
    expect(isFeatureEnabledMock).toHaveBeenCalledWith(
      'new-dashboard',
      '123e4567-e89b-42d3-a456-426614174000',
      { sendFeatureFlagEvents: false },
    );
  });

  it('returns the fallback without constructing a client when telemetry is disabled', async () => {
    vi.mocked(resolveTelemetryEnabled).mockReturnValue(false);
    const analytics = new AnalyticsService('server');

    await expect(analytics.isFeatureEnabled('new-dashboard', false)).resolves.toBe(false);

    expect(postHogConstructorMock).not.toHaveBeenCalled();
    expect(isFeatureEnabledMock).not.toHaveBeenCalled();
  });

  it('returns an explicit config override without evaluating the remote flag', async () => {
    const analytics = new AnalyticsService('server', {
      featureFlagOverrides: { 'new-dashboard': false },
    });

    await expect(analytics.isFeatureEnabled('new-dashboard', true)).resolves.toBe(false);

    expect(postHogConstructorMock).not.toHaveBeenCalled();
    expect(isFeatureEnabledMock).not.toHaveBeenCalled();
  });

  it('returns the remote boolean and clears the timeout', async () => {
    isFeatureEnabledMock.mockResolvedValue(true);
    const analytics = new AnalyticsService('server');

    await expect(analytics.isFeatureEnabled('new-dashboard', false)).resolves.toBe(true);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns the fallback when remote evaluation fails', async () => {
    isFeatureEnabledMock.mockRejectedValue(new Error('offline'));
    const analytics = new AnalyticsService('server');

    await expect(analytics.isFeatureEnabled('new-dashboard', true)).resolves.toBe(true);
  });
});
