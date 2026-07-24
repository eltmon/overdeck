import { Effect } from 'effect';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeConfigs } from '../../../src/lib/config-yaml.js';
import { loadSettingsApi, saveSettingsApi } from '../../../src/lib/settings-api.js';
import {
  getAnalyticsService,
  synchronizeAnalyticsServices,
} from '../../../src/lib/telemetry/service.js';

const loadConfigSyncMock = vi.hoisted(() => vi.fn());
const getOrCreateInstallIdMock = vi.hoisted(() => vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'));
const writeFileMock = vi.hoisted(() => vi.fn(async () => undefined));
const captureMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const isFeatureEnabledMock = vi.hoisted(() => vi.fn(async () => true));
const shutdownMock = vi.hoisted(() => vi.fn(async () => undefined));
const postHogConstructorMock = vi.hoisted(() => vi.fn(function PostHogMock() {
  return {
    capture: captureMock,
    captureException: captureExceptionMock,
    isFeatureEnabled: isFeatureEnabledMock,
    shutdown: shutdownMock,
  };
}));

vi.mock('posthog-node', () => ({ PostHog: postHogConstructorMock }));
vi.mock('../../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/config-yaml.js')>();
  return {
    ...actual,
    loadConfigSync: loadConfigSyncMock,
    getGlobalConfigPath: vi.fn(() => '/test/config.yaml'),
    clearConfigCache: vi.fn(),
  };
});

vi.mock('../../../src/lib/telemetry/install-id.js', () => ({
  getOrCreateInstallId: getOrCreateInstallIdMock,
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(async () => {
      const error = new Error('missing config') as Error & { code: string };
      error.code = 'ENOENT';
      throw error;
    }),
    writeFile: writeFileMock,
  };
});

const originalTelemetryEnv = process.env.OVERDECK_TELEMETRY;
const originalVitest = process.env.VITEST;
const originalNodeEnv = process.env.NODE_ENV;

function useTelemetryConfig(enabled?: boolean): void {
  const yamlConfig = enabled === undefined ? {} : { telemetry: { enabled } };
  loadConfigSyncMock.mockReturnValue({ config: mergeConfigs(yamlConfig).config });
}

describe('settings telemetry', () => {
  beforeEach(async () => {
    await getAnalyticsService('server').shutdown();
    delete process.env.OVERDECK_TELEMETRY;
    loadConfigSyncMock.mockReset();
    getOrCreateInstallIdMock.mockClear();
    vi.clearAllMocks();
    useTelemetryConfig();
    writeFileMock.mockImplementation(async (_path, content) => {
      const written = parse(String(content)) as { telemetry?: { enabled?: boolean } };
      useTelemetryConfig(written.telemetry?.enabled);
    });
  });

  afterEach(async () => {
    useTelemetryConfig(false);
    await synchronizeAnalyticsServices();
    if (originalTelemetryEnv === undefined) {
      delete process.env.OVERDECK_TELEMETRY;
    } else {
      process.env.OVERDECK_TELEMETRY = originalTelemetryEnv;
    }
    if (originalVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = originalVitest;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns default enabled state and the read-only install ID', () => {
    expect(loadSettingsApi().telemetry).toEqual({
      enabled: true,
      effectiveEnabled: true,
      installId: '123e4567-e89b-42d3-a456-426614174000',
    });
  });

  it('persists telemetry.enabled and returns the saved state on the next load', async () => {
    const settings = loadSettingsApi();
    settings.telemetry = { ...settings.telemetry!, enabled: false };

    await Effect.runPromise(saveSettingsApi(settings));

    const writtenYaml = writeFileMock.mock.calls.at(-1)?.[1];
    expect(parse(String(writtenYaml)).telemetry).toEqual({ enabled: false });

    useTelemetryConfig(false);
    expect(loadSettingsApi().telemetry?.enabled).toBe(false);
  });

  it('stops shared Node telemetry immediately after persisting opt-out', async () => {
    delete process.env.VITEST;
    delete process.env.NODE_ENV;
    useTelemetryConfig(true);
    const analytics = getAnalyticsService('server');
    analytics.capture('server_boot', { project_count: '0', active_agent_count: '0' });
    expect(postHogConstructorMock).toHaveBeenCalledTimes(1);

    const settings = loadSettingsApi();
    settings.telemetry = { ...settings.telemetry!, enabled: false };
    await Effect.runPromise(saveSettingsApi(settings));
    expect(shutdownMock).toHaveBeenCalledTimes(1);

    captureMock.mockClear();
    captureExceptionMock.mockClear();
    isFeatureEnabledMock.mockClear();
    postHogConstructorMock.mockClear();

    analytics.capture('project_created', { mode: 'new' });
    analytics.captureException(
      new Error('PAN-2599 /home/alice/private-repo ghp_secret'),
      { action: 'server_boot' },
    );
    await expect(analytics.isFeatureEnabled('test-flag', false)).resolves.toBe(false);

    expect(postHogConstructorMock).not.toHaveBeenCalled();
    expect(captureMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(isFeatureEnabledMock).not.toHaveBeenCalled();
  });

  it('preserves configured telemetry during an unrelated save under env opt-out', async () => {
    useTelemetryConfig(true);
    process.env.OVERDECK_TELEMETRY = '0';
    const settings = loadSettingsApi();
    settings.tmux = { config_mode: 'inherit-user' };

    await Effect.runPromise(saveSettingsApi(settings));

    const writtenYaml = writeFileMock.mock.calls.at(-1)?.[1];
    expect(parse(String(writtenYaml)).telemetry).toEqual({ enabled: true });
  });

  it('reports configured and effective state separately under env opt-out', () => {
    useTelemetryConfig(true);
    process.env.OVERDECK_TELEMETRY = '0';

    expect(loadSettingsApi().telemetry).toEqual({
      enabled: true,
      effectiveEnabled: false,
      installId: '123e4567-e89b-42d3-a456-426614174000',
    });
  });
});
