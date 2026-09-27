import type { TelemetryConfig } from './config-yaml/schema.js';
import { resolveTelemetryEnabled } from './telemetry/config.js';
import { getOrCreateInstallId } from './telemetry/install-id.js';
import { getOperatorHashIfEnabled } from './telemetry/operator-hash.js';

export interface ApiTelemetryConfig {
  enabled: boolean;
  effectiveEnabled?: boolean;
  installId?: string;
  /** PAN-4264: send the pseudonymous operatorHash so one operator's installs group. */
  operatorGrouping?: boolean;
  /** PAN-4264: the 16-hex hash itself, when grouping is on and a hash exists. */
  operatorHash?: string;
}

export function validateApiTelemetryConfig(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['telemetry must be an object'];
  }
  const telemetry = value as Partial<Record<keyof ApiTelemetryConfig, unknown>>;
  const errors: string[] = [];
  if (typeof telemetry.enabled !== 'boolean') errors.push('telemetry.enabled must be a boolean');
  if (telemetry.effectiveEnabled !== undefined && typeof telemetry.effectiveEnabled !== 'boolean') {
    errors.push('telemetry.effectiveEnabled must be a boolean');
  }
  if (telemetry.installId !== undefined && typeof telemetry.installId !== 'string') {
    errors.push('telemetry.installId must be a string');
  }
  if (telemetry.operatorGrouping !== undefined && typeof telemetry.operatorGrouping !== 'boolean') {
    errors.push('telemetry.operatorGrouping must be a boolean');
  }
  if (telemetry.operatorHash !== undefined && typeof telemetry.operatorHash !== 'string') {
    errors.push('telemetry.operatorHash must be a string');
  }
  return errors;
}

/** The API view of the `telemetry` config block (PAN-4264 adds operator grouping). */
export function telemetrySettingsFromConfig(telemetry: TelemetryConfig | undefined): ApiTelemetryConfig {
  const operatorHash = getOperatorHashIfEnabled();
  return {
    enabled: telemetry?.enabled ?? true,
    effectiveEnabled: resolveTelemetryEnabled(),
    installId: getOrCreateInstallId(),
    operatorGrouping: telemetry?.operator_grouping ?? false,
    ...(operatorHash ? { operatorHash } : {}),
  };
}
