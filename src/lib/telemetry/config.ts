import { loadConfigSync } from '../config-yaml.js';

export function telemetryEnvironmentForcesOff(): boolean {
  const envValue = process.env.OVERDECK_TELEMETRY?.trim().toLowerCase();
  return envValue === '0' || envValue === 'false';
}

export function resolveTelemetryEnabled(): boolean {
  if (telemetryEnvironmentForcesOff()) return false;
  return loadConfigSync().config.telemetry?.enabled !== false;
}
