import { Effect } from 'effect';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeConfigs } from '../../../src/lib/config-yaml.js';
import { loadSettingsApi, saveSettingsApi } from '../../../src/lib/settings-api.js';

const loadConfigSyncMock = vi.hoisted(() => vi.fn());
const getOrCreateInstallIdMock = vi.hoisted(() => vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'));
const writeFileMock = vi.hoisted(() => vi.fn(async () => undefined));

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

function useTelemetryConfig(enabled?: boolean): void {
  const yamlConfig = enabled === undefined ? {} : { telemetry: { enabled } };
  loadConfigSyncMock.mockReturnValue({ config: mergeConfigs(yamlConfig).config });
}

describe('settings telemetry', () => {
  beforeEach(() => {
    delete process.env.OVERDECK_TELEMETRY;
    loadConfigSyncMock.mockReset();
    getOrCreateInstallIdMock.mockClear();
    writeFileMock.mockClear();
    useTelemetryConfig();
  });

  afterEach(() => {
    if (originalTelemetryEnv === undefined) {
      delete process.env.OVERDECK_TELEMETRY;
    } else {
      process.env.OVERDECK_TELEMETRY = originalTelemetryEnv;
    }
  });

  it('returns default enabled state and the read-only install ID', () => {
    expect(loadSettingsApi().telemetry).toEqual({
      enabled: true,
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

  it('reports telemetry disabled when the environment forces opt-out', () => {
    useTelemetryConfig(true);
    process.env.OVERDECK_TELEMETRY = '0';

    expect(loadSettingsApi().telemetry?.enabled).toBe(false);
  });
});
