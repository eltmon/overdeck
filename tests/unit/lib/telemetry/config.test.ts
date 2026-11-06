import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfigSync, mergeConfigs, type YamlConfig } from '../../../../src/lib/config-yaml.js';
import { resolveTelemetryEnabled, resolveTelemetryState } from '../../../../src/lib/telemetry/config.js';
import { detectTelemetryAutoExclusion } from '../../../../src/lib/telemetry/environment.js';

vi.mock('../../../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/config-yaml.js')>();
  return { ...actual, loadConfigSync: vi.fn() };
});

vi.mock('../../../../src/lib/telemetry/environment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/telemetry/environment.js')>();
  return { ...actual, detectTelemetryAutoExclusion: vi.fn(() => null) };
});

const originalTelemetryEnv = process.env.OVERDECK_TELEMETRY;

function mockConfig(config: YamlConfig = {}): void {
  vi.mocked(loadConfigSync).mockReturnValue({ config: mergeConfigs(config).config });
}

describe('resolveTelemetryEnabled', () => {
  beforeEach(() => {
    delete process.env.OVERDECK_TELEMETRY;
    vi.mocked(loadConfigSync).mockReset();
    vi.mocked(detectTelemetryAutoExclusion).mockReturnValue(null);
    mockConfig();
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

describe('resolveTelemetryState precedence', () => {
  beforeEach(() => {
    delete process.env.OVERDECK_TELEMETRY;
    vi.mocked(loadConfigSync).mockReset();
    vi.mocked(detectTelemetryAutoExclusion).mockReturnValue(null);
    mockConfig();
  });

  afterEach(() => {
    if (originalTelemetryEnv === undefined) {
      delete process.env.OVERDECK_TELEMETRY;
    } else {
      process.env.OVERDECK_TELEMETRY = originalTelemetryEnv;
    }
  });

  it('reports disabledBy ci or temporary_home from the auto-exclusion detector', () => {
    vi.mocked(detectTelemetryAutoExclusion).mockReturnValue('ci');
    expect(resolveTelemetryState()).toEqual({ enabled: false, disabledBy: 'ci' });

    vi.mocked(detectTelemetryAutoExclusion).mockReturnValue('temporary_home');
    expect(resolveTelemetryState()).toEqual({ enabled: false, disabledBy: 'temporary_home' });
  });

  it('lets OVERDECK_TELEMETRY=1 override a ci exclusion, but never an explicit config false', () => {
    vi.mocked(detectTelemetryAutoExclusion).mockReturnValue('ci');
    process.env.OVERDECK_TELEMETRY = '1';
    expect(resolveTelemetryState()).toEqual({ enabled: true });

    mockConfig({ telemetry: { enabled: false } });
    expect(resolveTelemetryState()).toEqual({ enabled: false, disabledBy: 'config' });
  });

  it('short-circuits on OVERDECK_TELEMETRY=0/false before the YAML read, even one that throws', () => {
    vi.mocked(detectTelemetryAutoExclusion).mockReturnValue('ci');
    process.env.OVERDECK_TELEMETRY = '0';
    expect(resolveTelemetryState()).toEqual({ enabled: false, disabledBy: 'environment' });

    vi.mocked(loadConfigSync).mockImplementation(() => { throw new Error('unreadable config'); });
    expect(resolveTelemetryState()).toEqual({ enabled: false, disabledBy: 'environment' });
  });

  it('trusts an explicit configuredEnabled argument over the YAML read', () => {
    expect(resolveTelemetryState(false)).toEqual({ enabled: false, disabledBy: 'config' });
    expect(loadConfigSync).not.toHaveBeenCalled();
  });
});
