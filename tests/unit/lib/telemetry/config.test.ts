import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfigSync, mergeConfigs, type YamlConfig } from '../../../../src/lib/config-yaml.js';
import { resolveTelemetryEnabled } from '../../../../src/lib/telemetry/config.js';

vi.mock('../../../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/config-yaml.js')>();
  return { ...actual, loadConfigSync: vi.fn() };
});

const originalTelemetryEnv = process.env.OVERDECK_TELEMETRY;

function mockConfig(config: YamlConfig = {}): void {
  vi.mocked(loadConfigSync).mockReturnValue({ config: mergeConfigs(config).config });
}

describe('resolveTelemetryEnabled', () => {
  beforeEach(() => {
    delete process.env.OVERDECK_TELEMETRY;
    vi.mocked(loadConfigSync).mockReset();
  });

  afterEach(() => {
    if (originalTelemetryEnv === undefined) {
      delete process.env.OVERDECK_TELEMETRY;
    } else {
      process.env.OVERDECK_TELEMETRY = originalTelemetryEnv;
    }
  });

  it('defaults telemetry to enabled when the config block is absent', () => {
    mockConfig();

    expect(mergeConfigs({}).config.telemetry.enabled).toBe(true);
    expect(resolveTelemetryEnabled()).toBe(true);
  });

  it('honors telemetry.enabled false', () => {
    mockConfig({ telemetry: { enabled: false } });

    expect(resolveTelemetryEnabled()).toBe(false);
  });

  it.each(['0', 'false'])('lets OVERDECK_TELEMETRY=%s force telemetry off', (value) => {
    mockConfig({ telemetry: { enabled: true } });
    process.env.OVERDECK_TELEMETRY = value;

    expect(resolveTelemetryEnabled()).toBe(false);
  });
});
