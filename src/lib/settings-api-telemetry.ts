export interface ApiTelemetryConfig {
  enabled: boolean;
  effectiveEnabled?: boolean;
  installId?: string;
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
  return errors;
}
