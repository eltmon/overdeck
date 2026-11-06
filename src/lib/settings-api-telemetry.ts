import { TELEMETRY_INSTALL_KINDS, type TelemetryInstallKind } from '@overdeck/contracts';
import type { TelemetryConfig } from './config-yaml/schema.js';
import { resolveTelemetryState, type TelemetryDisabledReason } from './telemetry/config.js';
import { getOrCreateInstallId } from './telemetry/install-id.js';
import { getInstallKind } from './telemetry/install-kind.js';
import { getOperatorHashIfEnabled } from './telemetry/operator-hash.js';

const TELEMETRY_DISABLED_REASONS: readonly TelemetryDisabledReason[] = ['environment', 'config', 'ci', 'temporary_home'];

export interface ApiTelemetryConfig {
  enabled: boolean;
  effectiveEnabled?: boolean;
  /** PAN-5084: why effectiveEnabled is false; omitted when telemetry is on. */
  disabledBy?: TelemetryDisabledReason;
  installId?: string;
  /** PAN-5084: what kind of install reported telemetry (user/remote_vm/dev_checkout/container). */
  installKind?: TelemetryInstallKind;
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
  if (
    telemetry.disabledBy !== undefined
    && (typeof telemetry.disabledBy !== 'string' || !TELEMETRY_DISABLED_REASONS.includes(telemetry.disabledBy as TelemetryDisabledReason))
  ) {
    errors.push(`telemetry.disabledBy must be one of ${TELEMETRY_DISABLED_REASONS.join(', ')}`);
  }
  if (telemetry.installId !== undefined && typeof telemetry.installId !== 'string') {
    errors.push('telemetry.installId must be a string');
  }
  if (
    telemetry.installKind !== undefined
    && (typeof telemetry.installKind !== 'string' || !TELEMETRY_INSTALL_KINDS.includes(telemetry.installKind as TelemetryInstallKind))
  ) {
    errors.push(`telemetry.installKind must be one of ${TELEMETRY_INSTALL_KINDS.join(', ')}`);
  }
  if (telemetry.operatorGrouping !== undefined && typeof telemetry.operatorGrouping !== 'boolean') {
    errors.push('telemetry.operatorGrouping must be a boolean');
  }
  if (telemetry.operatorHash !== undefined && typeof telemetry.operatorHash !== 'string') {
    errors.push('telemetry.operatorHash must be a string');
  }
  return errors;
}

/** The API view of the `telemetry` config block (PAN-4264 adds operator grouping, PAN-5084 adds disabledBy/installKind). */
export function telemetrySettingsFromConfig(telemetry: TelemetryConfig | undefined): ApiTelemetryConfig {
  const operatorHash = getOperatorHashIfEnabled();
  const enabled = telemetry?.enabled ?? true;
  const state = resolveTelemetryState(enabled);
  return {
    enabled,
    effectiveEnabled: state.enabled,
    ...(state.disabledBy ? { disabledBy: state.disabledBy } : {}),
    installId: getOrCreateInstallId(),
    installKind: getInstallKind(),
    operatorGrouping: telemetry?.operator_grouping ?? false,
    ...(operatorHash ? { operatorHash } : {}),
  };
}

/** PAN-5084: merge a telemetry save update through the same door the load path uses. */
export function mergeApiTelemetrySettings(
  current: ApiTelemetryConfig | undefined,
  updates: ApiTelemetryConfig | undefined,
): ApiTelemetryConfig {
  const enabled = updates?.enabled ?? current?.enabled ?? true;
  const state = resolveTelemetryState(enabled);
  return {
    enabled,
    effectiveEnabled: state.enabled,
    ...(state.disabledBy ? { disabledBy: state.disabledBy } : {}),
    installId: current?.installId,
    installKind: current?.installKind,
    operatorGrouping: updates?.operatorGrouping ?? current?.operatorGrouping ?? false,
    ...(current?.operatorHash ? { operatorHash: current.operatorHash } : {}),
  };
}
