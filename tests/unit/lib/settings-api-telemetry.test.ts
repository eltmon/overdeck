import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  telemetryClientConfig,
  telemetrySettingsFromConfig,
  validateApiTelemetryConfig,
} from '../../../src/lib/settings-api-telemetry.js';

const resolveTelemetryStateMock = vi.hoisted(() => vi.fn());
const getOrCreateInstallIdMock = vi.hoisted(() => vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'));
const getInstallKindMock = vi.hoisted(() => vi.fn(() => 'user'));
const getOperatorHashIfEnabledMock = vi.hoisted(() => vi.fn(() => undefined));
const getBuildInfoMock = vi.hoisted(() => vi.fn(() => ({ buildCommit: null })));

vi.mock('../../../src/lib/telemetry/config.js', () => ({
  resolveTelemetryState: resolveTelemetryStateMock,
}));

vi.mock('../../../src/lib/telemetry/install-id.js', () => ({
  getOrCreateInstallId: getOrCreateInstallIdMock,
}));

vi.mock('../../../src/lib/telemetry/install-kind.js', () => ({
  getInstallKind: getInstallKindMock,
}));

vi.mock('../../../src/lib/telemetry/operator-hash.js', () => ({
  getOperatorHashIfEnabled: getOperatorHashIfEnabledMock,
}));

vi.mock('../../../src/lib/deploy/build-info.js', () => ({
  getBuildInfo: getBuildInfoMock,
}));

describe('telemetryClientConfig', () => {
  beforeEach(() => {
    resolveTelemetryStateMock.mockReset();
    getOrCreateInstallIdMock.mockClear();
    getInstallKindMock.mockClear();
    getOperatorHashIfEnabledMock.mockReturnValue(undefined);
    getBuildInfoMock.mockReturnValue({ buildCommit: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns exactly { effectiveEnabled: false } when telemetry resolves off', () => {
    resolveTelemetryStateMock.mockReturnValue({ enabled: false, disabledBy: 'config' });

    expect(telemetryClientConfig()).toEqual({ effectiveEnabled: false });
  });

  it('returns every field when telemetry resolves on', () => {
    resolveTelemetryStateMock.mockReturnValue({ enabled: true });
    getOperatorHashIfEnabledMock.mockReturnValue('deadbeefdeadbeef');
    getBuildInfoMock.mockReturnValue({ buildCommit: 'abc1234' });

    const config = telemetryClientConfig();

    expect(config.effectiveEnabled).toBe(true);
    expect(config.installId).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(config.installKind).toBe('user');
    expect(config.buildCommit).toBe('abc1234');
    expect(config.operatorHash).toBe('deadbeefdeadbeef');
    expect(typeof config.posthogKey).toBe('string');
    expect(typeof config.posthogHost).toBe('string');
  });

  it('omits buildCommit when getBuildInfo().buildCommit is null', () => {
    resolveTelemetryStateMock.mockReturnValue({ enabled: true });
    getBuildInfoMock.mockReturnValue({ buildCommit: null });

    const config = telemetryClientConfig();

    expect(config).not.toHaveProperty('buildCommit');
  });
});

describe('telemetrySettingsFromConfig', () => {
  beforeEach(() => {
    resolveTelemetryStateMock.mockReset();
    getOperatorHashIfEnabledMock.mockReturnValue(undefined);
    getBuildInfoMock.mockReturnValue({ buildCommit: null });
  });

  it('omits buildCommit when getBuildInfo().buildCommit is null', () => {
    resolveTelemetryStateMock.mockReturnValue({ enabled: true });

    expect(telemetrySettingsFromConfig(undefined)).not.toHaveProperty('buildCommit');
  });

  it('includes buildCommit when getBuildInfo().buildCommit is a non-empty string', () => {
    resolveTelemetryStateMock.mockReturnValue({ enabled: true });
    getBuildInfoMock.mockReturnValue({ buildCommit: 'abc1234' });

    expect(telemetrySettingsFromConfig(undefined).buildCommit).toBe('abc1234');
  });
});

describe('validateApiTelemetryConfig', () => {
  it('rejects a non-string buildCommit', () => {
    expect(validateApiTelemetryConfig({ enabled: true, buildCommit: 5 })).toContain(
      'telemetry.buildCommit must be a string',
    );
  });

  it('accepts a string buildCommit', () => {
    expect(validateApiTelemetryConfig({ enabled: true, buildCommit: 'abc1234' })).not.toContain(
      'telemetry.buildCommit must be a string',
    );
  });
});
