import { loadConfigSync } from '../config-yaml.js';
import { detectTelemetryAutoExclusion, telemetryEnvironmentForcesOn } from './environment.js';

export function telemetryEnvironmentForcesOff(): boolean {
  const envValue = process.env.OVERDECK_TELEMETRY?.trim().toLowerCase();
  return envValue === '0' || envValue === 'false';
}

export type TelemetryDisabledReason = 'environment' | 'config' | 'ci' | 'temporary_home';

export interface TelemetryState {
  enabled: boolean;
  disabledBy?: TelemetryDisabledReason;
}

/**
 * PAN-5084: six-row precedence table, first match wins. The config read is
 * lazy so OVERDECK_TELEMETRY=0/false disables telemetry even when the YAML
 * read would throw.
 */
export function resolveTelemetryState(configuredEnabled?: boolean): TelemetryState {
  if (telemetryEnvironmentForcesOff()) return { enabled: false, disabledBy: 'environment' };

  const enabled = configuredEnabled ?? loadConfigSync().config.telemetry?.enabled !== false;
  if (!enabled) return { enabled: false, disabledBy: 'config' };

  if (telemetryEnvironmentForcesOn()) return { enabled: true };

  const exclusion = detectTelemetryAutoExclusion();
  if (exclusion) return { enabled: false, disabledBy: exclusion };

  return { enabled: true };
}

export function resolveTelemetryEnabled(): boolean {
  return resolveTelemetryState().enabled;
}
